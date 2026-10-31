# assets/items/*.png 를 src/client/itemIcons.ts 의 data URI로 묶는다.
# 이미지를 코드에 넣어 두면 단일 HTML(아티팩트)과 서버 배포 양쪽에서 경로 걱정 없이 쓸 수 있다.
import base64, os

here = os.path.dirname(__file__)
src = os.path.join(here, '..', 'assets', 'items')
out = os.path.join(here, '..', 'src', 'client', 'itemIcons.ts')
lines = ['// scripts/build-icons.py 가 만든 파일. 직접 고치지 말고 스크립트를 다시 돌리세요.', 'export const ITEM_ICONS: Record<string, string> = {']
for name in sorted(os.listdir(src)):
    if name.endswith('.png'):
        b64 = base64.b64encode(open(os.path.join(src, name), 'rb').read()).decode()
        lines.append(f"  {name[:-4]}: 'data:image/png;base64,{b64}',")
lines.append('};')
open(out, 'w').write('\n'.join(lines) + '\n')
print(out, os.path.getsize(out))
