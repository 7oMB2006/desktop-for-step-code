"""Isolated acceptance peer: real companion event client, simulated Hermes injection host."""
import json
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(sys.argv[1]).parent))
import external

notified = threading.Event()
messages = []


class Host:
    def inject_message(self, content, *, session_key):
        if session_key != 'isolated-origin-session':
            raise AssertionError('Wake routed to another session')
        messages.append({'content': content, 'sessionKey': session_key})
        notified.set()
        return True


runtime = external.ExternalIntegration(external.load_connector(Path(sys.argv[2])), Host())
try:
    runtime.bind(sys.argv[3], 'isolated-origin-session')
    if not notified.wait(35):
        raise AssertionError('No delegated approval wake received')
finally:
    runtime.stop()
if runtime.thread.is_alive():
    raise AssertionError('Event client did not stop')
print(json.dumps({'messages': messages, 'simulatedHermesHost': True}, ensure_ascii=False))
