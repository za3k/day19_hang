#!/bin/python3
import flask, flask_login
from flask import url_for, request, render_template, redirect
from flask_login import current_user
from flask_sock import Sock
import collections, json, queue, random
from datetime import datetime
from base import app,load_info,ajax,DBDict,DBList,random_id,hash_id,full_url_for

# -- Info for every Hack-A-Day project --
load_info({
    "project_name": "Hack-A-Hang",
    "source_url": "https://github.com/za3k/day19_hang",
    "subdir": "/hackaday/hang",
    "description": "a place to hang and talk with your friends",
    "instructions": "Click one of the links above to get started. (Registration is optional.)",
    "login": True,
    "fullscreen": False,
})

# -- Routes specific to this Hack-A-Day project --

# Basic pub-sub on broadcast channels. No major effort is made to clean up channels.
class BroadcastListener():
    def __init__(self, speaker):
        self.speaker = speaker
        self.queue = queue.Queue(5)
    def put(self, message):
        while True:
            try:
                return self.queue.put(message, block=False)
            except queue.Full:
                _ = self.queue.get(block=False)
    def next(self):
        return self.queue.get()
    def __enter__(self):
        return self
    def __exit__(self):
        self.close()
    def close(self):
        self.speaker.listeners.remove(self)
class BroadcastSpeaker():
    def __init__(self):
        self.listeners = []
    def listener(self):
        l = BroadcastListener(self)
        self.listeners.append(l)
        return l
    def put(self, message):
        for l in self.listeners:
            l.put(message)
rooms = collections.defaultdict(BroadcastSpeaker)

@app.route("/")
def index():
    return render_template('index.html')

@app.route("/r/<hang_id>")
def hang(hang_id):
    return render_template('hang.html', hang_id=hang_id)

@app.route("/new")
def hang_new():
    return redirect(url_for("hang", hang_id=random_id()))
    
sock = Sock(app)
@sock.route("/ws/<room_id>")
def hang_listen(ws, room_id):
    with rooms[room_id].listener() as reader:
        while True:
            ws.send(reader.next())

@ajax("/ajax/<room_id>/send")
def hang_send(j, room_id):
    rooms[room_id].put(json.dumps(j)) # No need to be parsing this, really
    return {"success": True}
