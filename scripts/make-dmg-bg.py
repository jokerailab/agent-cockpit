#!/usr/bin/env python3
"""Generate the DMG background with drag-to-install + first-open instructions.
Matches the app aesthetic: warm paper, ink black, safety orange."""
from PIL import Image, ImageDraw, ImageFont

W, H, S = 560, 470, 2  # logical size + 2x scale for retina crispness
PAPER = (236, 229, 211)
INK = (28, 26, 23)
INK2 = (92, 86, 76)
INK3 = (140, 132, 118)
ORANGE = (226, 58, 15)
LINE = (203, 194, 175)

img = Image.new("RGB", (W * S, H * S), PAPER)
d = ImageDraw.Draw(img)

def font(path_list, size, index=0):
    for p in path_list:
        try:
            return ImageFont.truetype(p, size * S, index=index)
        except Exception:
            continue
    return ImageFont.load_default()

HEI = ["/System/Library/Fonts/PingFang.ttc",
       "/System/Library/Fonts/STHeiti Medium.ttc",
       "/System/Library/Fonts/Hiragino Sans GB.ttc"]
MONO = ["/System/Library/Fonts/SFNSMono.ttf",
        "/System/Library/Fonts/Menlo.ttc"]

# PingFang.ttc: index 2 renders CJK+Latin crisply; 4/8 give tofu/thin → use 2 for all
f_title = font(HEI, 34, index=2)
f_sub = font(HEI, 15, index=2)
f_step = font(HEI, 15, index=2)
f_small = font(HEI, 11, index=2)

def ctext(x, y, s, fnt, fill, anchor="mm"):
    d.text((x * S, y * S), s, font=fnt, fill=fill, anchor=anchor)

# title
ctext(W / 2, 48, "Agent Cockpit", f_title, INK)
ctext(W / 2, 82, "① 把图标拖到 Applications 完成安装", f_sub, INK2)

# drag row: app icon lands at (150,205), Applications at (410,205);
# orange arrow points across the gap between them
ay = 205
d.line([(236 * S, ay * S), (322 * S, ay * S)], fill=ORANGE, width=3 * S)
d.polygon([(322 * S, (ay - 7) * S), (340 * S, ay * S), (322 * S, (ay + 7) * S)], fill=ORANGE)

# divider
d.line([(48 * S, 300 * S), ((W - 48) * S, 300 * S)], fill=LINE, width=1 * S)

# first-open steps
ctext(W / 2, 326, "首次打开（一次性，无需终端）", f_sub, ORANGE)
steps = [
    "② 在「应用程序」里双击 → 提示“无法验证” → 点【完成】",
    "③ 打开 系统设置 → 隐私与安全性 → 下滑点【仍要打开】",
    "④ 确认并输入开机密码即可。之后双击直接打开，不再拦截",
]
y = 356
for s in steps:
    ctext(W / 2, y, s, f_step, INK2)
    y += 29
ctext(W / 2, 452, "仅 Apple Silicon · 未公证(自签) · 数据全部留在本机", f_small, INK3)

img.save("build/dmg-bg.png")
img.resize((W, H), Image.LANCZOS).save("build/dmg-bg-1x.png")
print("wrote build/dmg-bg.png (%dx%d)" % (W * S, H * S))
