import sys
from flask import Flask, request, jsonify
import argparse

app = Flask(__name__)

@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
def echo(path):
    return jsonify({
        'method': request.method,
        'path': request.path,
        'headers': dict(request.headers),
        'args': request.args.to_dict(),
        'form': request.form.to_dict(),
        'json': request.get_json(silent=True),
        'data': request.data.decode('utf-8'),
    })

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    app.run(host='0.0.0.0', port=args.port)
