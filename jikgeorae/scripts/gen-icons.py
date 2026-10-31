# PixelLab API로 물건 아이콘 20종을 만든다. 이미 있는 파일은 건너뛴다.
#   python3 scripts/gen-icons.py            (PIXELLAB_API_KEY 필요)
import base64, json, os, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

ITEMS = {
    'gameboy': 'retro handheld game console with small screen and d-pad, red and grey',
    'cartridge': 'stack of three retro video game cartridges, colorful labels',
    'padset': 'classic wired retro game controller gamepad, grey with red buttons',
    'limitedconsole': 'limited edition gold retro home video game console',
    'robot': 'toy robot action figure, blue and white mecha',
    'anime': 'cute anime girl figurine standing on round base',
    'limitedfig': 'rare golden collectible dragon figure statue on pedestal',
    'plamodel': 'sealed plastic model kit box with robot picture on lid',
    'cassette': 'portable cassette tape player with headphones',
    'turntable': 'vintage record turntable with black vinyl record',
    'lpset': 'stack of vinyl LP records in colorful album sleeves',
    'tubeamp': 'vintage vacuum tube audio amplifier with glowing orange tubes',
    'filmcam': 'vintage 35mm film camera, black and silver',
    'lens': 'black camera prime lens with glass front',
    'instant': 'white instant camera with rainbow stripe',
    'tripod': 'vintage wooden camera tripod',
    'sneakers': 'limited edition high top sneaker, white and red',
    'jacket': 'vintage blue denim jacket',
    'cap': 'black baseball cap with colorful logo',
    'watch': 'classic gold wristwatch with brown leather strap',
}

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'items')
KEY = os.environ.get('PIXELLAB_API_KEY', 'dummy')


def gen(item_id: str, desc: str) -> str:
    path = os.path.join(OUT, f'{item_id}.png')
    if os.path.exists(path):
        return f'{item_id}: 있음'
    body = json.dumps({
        'description': f'pixel art game inventory icon, single object centered, {desc}',
        'image_size': {'width': 64, 'height': 64},
        'no_background': True,
        'outline': 'single color black outline',
        'shading': 'medium shading',
        'detail': 'medium detail',
        'view': 'side',
    }).encode()
    req = urllib.request.Request(
        'https://api.pixellab.ai/v1/generate-image-pixflux',
        data=body,
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if attempt == 3 or e.code < 500:
                raise
            time.sleep(2 ** attempt * 2)
    b64 = data['image']['base64'].split(',')[-1]
    with open(path, 'wb') as f:
        f.write(base64.b64decode(b64))
    return f'{item_id}: 생성'


if __name__ == '__main__':
    only = sys.argv[1:]
    todo = {k: v for k, v in ITEMS.items() if not only or k in only}
    with ThreadPoolExecutor(2) as ex:
        for line in ex.map(lambda kv: gen(*kv), todo.items()):
            print(line)
