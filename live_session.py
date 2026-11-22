"""Live clipping: record a live stream while it is on, watch chat speed, and cut a clip around every chat spike.

Pattern used by the live clippers (heistclips, Claude Clipper, stream-clipper): chat velocity in 10 s buckets against a
5-minute baseline, clip window BACKDATED from the spike because chat reacts after the moment, ready about a minute later.
Chat is read anonymously (Twitch IRC, no login; YouTube Live via pytchat). Recording uses Streamlink.
"""
import collections
import re
import socket
import statistics
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

BUCKET = 10        # seconds per chat bucket
HISTORY = 30       # buckets in the baseline (5 minutes)
SIGMA = 2.5        # spike = mean + SIGMA * stdev ...
RATIO = 2.5        # ... and at least RATIO x the baseline mean
MIN_MSGS = 8       # ... and at least this many messages in the bucket
COOLDOWN = 60      # seconds between two automatic clips


def parse_target(text):
    """-> ('twitch', channel, url) or ('youtube', video_id, url)."""
    t = text.strip()
    if 'youtu' in t:
        m = re.search(r'(?:v=|/live/|youtu\.be/)([A-Za-z0-9_-]{11})', t)
        if not m:
            raise ValueError('Paste a YouTube Live link that contains the video id.')
        return 'youtube', m.group(1), t if t.startswith('http') else 'https://' + t
    m = re.search(r'twitch\.tv/([A-Za-z0-9_]{3,25})', t)
    channel = (m.group(1) if m else t.lstrip('#@')).lower()
    if not re.fullmatch(r'[a-z0-9_]{3,25}', channel):
        raise ValueError('Paste a Twitch channel link (twitch.tv/name) or a YouTube Live link.')
    return 'twitch', channel, f'https://twitch.tv/{channel}'


class LiveSession:
    def __init__(self, target, data, render, before=24, after=14):
        self.kind, self.ref, self.url = target
        self.id = uuid.uuid4().hex
        self.dir = Path(data) / ('live_' + self.id)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.rec = self.dir / 'recording.ts'
        self.render, self.before, self.after = render, before, after
        self.counts = collections.Counter()
        self.stop_ev = threading.Event()
        self.t0 = None
        self.proc = None
        self.lock = threading.Lock()
        self.state = {'id': self.id, 'status': 'starting', 'stage': 'Starting the recorder', 'platform': self.kind, 'target': self.ref,
                      'clips': [], 'chat_now': 0, 'baseline': 0.0, 'spikes': 0, 'elapsed': 0, 'chat': 'connecting', 'pending': 0, 'error': None}

    # ---- helpers
    def _set(self, **kw):
        with self.lock:
            self.state.update(kw)

    def now(self):
        return (time.time() - self.t0) if self.t0 else 0.0

    # ---- chat readers
    def _twitch_chat(self):
        while not self.stop_ev.is_set():
            try:
                s = socket.create_connection(('irc.chat.twitch.tv', 6667), timeout=30)
                s.sendall(f'PASS SCHMOOPIIE\r\nNICK justinfan{int(time.time()) % 100000}\r\nJOIN #{self.ref}\r\n'.encode())
                self._set(chat='connected (read-only)')
                buf = ''
                while not self.stop_ev.is_set():
                    data = s.recv(4096).decode('utf-8', 'ignore')
                    if not data:
                        break
                    buf += data
                    *lines, buf = buf.split('\r\n')
                    for ln in lines:
                        if ln.startswith('PING'):
                            s.sendall(b'PONG :tmi.twitch.tv\r\n')
                        elif ' PRIVMSG ' in ln:
                            self.counts[int(time.time() // BUCKET)] += 1
            except Exception as e:
                self._set(chat='reconnecting (' + type(e).__name__ + ')')
                time.sleep(3)

    def _youtube_chat(self):
        try:
            import pytchat
        except ImportError:
            self._set(chat='pytchat is not installed (pip install pytchat)')
            return
        while not self.stop_ev.is_set():
            try:
                chat = pytchat.create(video_id=self.ref, interruptable=False)   # True needs the main thread (signal handler)
                self._set(chat='connected (read-only)')
                while chat.is_alive() and not self.stop_ev.is_set():
                    for _ in chat.get().sync_items():
                        self.counts[int(time.time() // BUCKET)] += 1
                    time.sleep(0.5)
            except Exception as e:
                self._set(chat='reconnecting (' + type(e).__name__ + ': ' + str(e)[:80] + ')')
                time.sleep(3)

    # ---- clips
    def _cut(self, start, dur, why, chat_feature):
        self._set(pending=self.state['pending'] + 1)
        try:
            clip = self.render(self, max(0.0, start), dur, why, chat_feature)
            if clip:
                with self.lock:
                    self.state['clips'].append(clip)
        except Exception as e:                     # one failed clip must not stop the session
            with self.lock:
                self.state['clips'].append({'error': str(e)[-200:], 'title': 'Clip failed', 'why': why})
        finally:
            self._set(pending=max(0, self.state['pending'] - 1))

    def clip_now(self, seconds=30):
        if not self.t0:
            raise RuntimeError('Recording has not started yet.')
        threading.Thread(target=self._cut, args=(self.now() - seconds, seconds, 'You pressed Clip now', None), daemon=True).start()

    def stop(self):
        self.stop_ev.set()
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        self._set(status='stopped', stage='Stopped. Clips already made stay in My clips.')

    # ---- main loop
    def start(self):
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            log = open(self.dir / 'streamlink.log', 'wb')
            self.proc = subprocess.Popen([sys.executable, '-m', 'streamlink', '--loglevel', 'warning', '--twitch-disable-ads', '--stdout', self.url, 'best'],
                                         stdout=open(self.rec, 'wb'), stderr=log)
            deadline = time.time() + 90
            while self.t0 is None:
                if self.proc.poll() is not None:
                    tail = (self.dir / 'streamlink.log').read_text(errors='ignore')[-300:] if (self.dir / 'streamlink.log').exists() else ''
                    raise RuntimeError('The stream is offline or could not be opened. ' + tail.strip().replace('\n', ' '))
                if self.rec.exists() and self.rec.stat().st_size > 0:
                    self.t0 = time.time()
                elif time.time() > deadline:
                    raise RuntimeError('Timed out waiting for the stream. Is it live?')
                time.sleep(0.5)
            threading.Thread(target=self._twitch_chat if self.kind == 'twitch' else self._youtube_chat, daemon=True).start()
            self._set(status='recording', stage='Recording and watching chat')
            last_clip, seen = -1e9, None
            while not self.stop_ev.is_set() and self.proc.poll() is None:
                time.sleep(1)
                done_bucket = int(time.time() // BUCKET) - 1
                self._set(elapsed=int(self.now()), chat_now=self.counts.get(done_bucket + 1, 0))
                if done_bucket == seen:
                    continue
                seen = done_bucket
                hist = [self.counts.get(b, 0) for b in range(done_bucket - HISTORY, done_bucket)]
                c = self.counts.get(done_bucket, 0)
                self._set(baseline=round(statistics.mean(hist), 1) if hist else 0.0)
                if len([h for h in hist if h]) < 6:
                    continue                                   # not enough chat history yet
                mu, sd = statistics.mean(hist), statistics.pstdev(hist) or 1.0
                at = done_bucket * BUCKET + BUCKET / 2 - self.t0
                if c >= MIN_MSGS and c > mu + SIGMA * sd and c >= RATIO * max(mu, 1.0) and at - last_clip > COOLDOWN:
                    last_clip = at
                    feature = min(1.0, c / (max(mu, 1.0) * 6.0))
                    self._set(spikes=self.state['spikes'] + 1)
                    why = f'Chat spike: {c} msgs/10s vs {mu:.0f} normal'
                    threading.Timer(self.after + 4, lambda a=at, w=why, f=feature: self._cut(a - self.before, self.before + self.after, w, f)).start()
            if not self.stop_ev.is_set():
                self._set(status='ended', stage='The stream ended.')
        except Exception as e:
            self._set(status='error', error=str(e)[-300:], stage='Could not start')
        finally:
            self.stop_ev.set()
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
