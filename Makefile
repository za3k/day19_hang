run-debug:
	flask --debug run
run-demo:
	gunicorn3 -e SCRIPT_NAME=/hackaday/hang --bind 0.0.0.0:8019 app:app
