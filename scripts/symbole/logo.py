# The app logo in the cel-shading style of the symbols (see stil.py): the house with the capybara in the door.
# Writes the 1024 master; scripts/icons.cjs draws the app icons from it. Run from this folder:
#   python3 logo.py ../../resources/logo.svg && node ../icons.cjs
import sys
from stil import *

# background of the icon and the lighter disc behind the house
GRUND = {'creme': ('#f6e4c6', '#fdf3e2'), 'himmel': ('#9fd3ee', '#c9e9f8'), 'nacht': ('#1f3639', '#2b484c')}
WAND = ('#fbf0df', '#dcc39d')
FELL = ('#c4925f', '#8f603c')
SCHNAUZE = ('#9a6840', '#70492d')
INNEN = '#4b3428'


def kreispfad(cx, cy, r):
    return f'M{n(cx - r)} {n(cy)} A{n(r)} {n(r)} 0 1 0 {n(cx + r)} {n(cy)} A{n(r)} {n(r)} 0 1 0 {n(cx - r)} {n(cy)} Z'


def schattiert(s, form, farbe, dx=-2.6, dy=-2.2):
    """A rounded form in two tones: the shadow tone, and on top the form moved towards the light in the lit tone –
    leaves a hard-edged shadow at the lower right."""
    licht = f'<path d="{form}" transform="translate({dx} {dy})" fill="{farbe[0]}" stroke="none"/>'
    return pfad(form, farbe[1]) + f'<g clip-path="{s.clip(form)}">{licht}</g>' + pfad(form, 'none')


def logo(busch=True):
    s = Symbol()
    s.unten.append(boden(61, 109.5, 52, 5.5, 0.22))
    dach_l = P([(15, 63), (64, 22), (64, 35), (21, 71)])
    dach_r = P([(64, 22), (113, 63), (107, 71), (64, 35)])
    dach = P([(15, 63), (64, 22), (113, 63), (107, 71), (64, 35), (21, 71)])
    wand = P([(28, 64), (64, 33), (100, 64), (100, 108), (28, 108)])
    kamin = P([(82, 46), (82, 28.5), (91, 28.5), (91, 46)])
    kappe = P([(80, 28.5), (80, 24), (93, 24), (93, 28.5)])
    gebuesch = 'M12 109 C8.5 103.5 11 96.5 17.5 96 C19 91 25.5 88.5 30.5 92 C34.5 90 39.5 93 39 98.5 C42 100.5 41.8 106.5 38.5 109 Z'
    s.k(kamin, kappe, wand, dach, *([gebuesch] if busch else []))

    # chimney: lit front, shaded right edge, the cap's shadow under it
    s += pfad(kamin, ROT[0])
    s += flaeche(P([(87.5, 28.5), (91, 28.5), (91, 46), (87.5, 46)]), ROT[1])
    s += flaeche(P([(82, 28.5), (91, 28.5), (91, 31.5), (82, 31.5)]), dunkler(ROT[1], 0.25))
    s += pfad(kamin, 'none')
    s += pfad(kappe, heller(ROT[0], 0.15))
    s += flaeche(P([(89.5, 24), (93, 24), (93, 28.5), (89.5, 28.5)]), ROT[1])
    s += pfad(kappe, 'none')

    # wall with the roof's shadow
    s += pfad(wand, WAND[0])
    s += f'<g clip-path="{s.clip(wand)}">' + flaeche(P([(21, 71), (64, 35), (107, 71), (107, 77), (64, 41), (21, 77)]), WAND[1]) + '</g>'
    s += pfad(wand, 'none')

    # round attic window
    s += kreis(64, 49.5, 7, ZIEGEL[0])
    s += kreis(64, 49.5, 4.4, GLAS, 1.6)
    s += f'<g clip-path="{s.clip(kreispfad(64, 49.5, 4.4))}">' + flaeche(P([(59, 44), (69, 44), (69, 47.2), (59, 47.2)]), T, 0.45) + '</g>'
    s += linie('M64 45.1 L64 53.9 M59.6 49.5 L68.4 49.5', 1.4)
    s += linie('M60.9 52.6 L62.6 50.9', 1.3, GLAS_LICHT)

    # door: frame and the dark hall behind
    rahmen = 'M45 108 L45 81 A19 19 0 0 1 83 81 L83 108 Z'
    oeffnung = 'M48.5 108 L48.5 81 A15.5 15.5 0 0 1 79.5 81 L79.5 108 Z'
    s += pfad(rahmen, ZIEGEL[0])
    s += glanz(bogen(64, 81, 17.2, 196, 252), 1.5)
    s += pfad(oeffnung, INNEN)
    s += s.schraffur(oeffnung, 'M47 76 L58 65 M47 82 L62 67 M47 88 L66 69 M47 94 L70 71 M50 97 L74 73 M58 95 L79 74 M66 93 L80 79', 1.2, 0.8)

    # the capybara: body, small ears, a long boxy head with the broad nose, sleepy eyes and the split lip – all inside the door
    koerper = 'M44 114 C44 101 52.5 95.5 64 95.5 C75.5 95.5 84 101 84 114 Z'
    kopf = 'M51.5 80 C51.5 73 56.5 70 64 70 C71.5 70 76.5 73 76.5 80 L77 92 C77 98 71.5 101 64 101 C56.5 101 51 98 51 92 Z'
    nase = 'M57.2 89.8 C57.2 87.5 59.8 86.4 64 86.4 C68.2 86.4 70.8 87.5 70.8 89.8 C70.8 91.9 68.2 93 64 93 C59.8 93 57.2 91.9 57.2 89.8 Z'
    tier = schattiert(s, koerper, FELL, -3, -2.5)
    tier += ellipse(65.5, 102, 10.5, 2.6, FELL[1], 0)
    for x, a, farbe in ((54.2, -35, FELL[0]), (73.8, 35, FELL[1])):
        tier += ellipse(x, 72, 3.2, 2.5, farbe, 1.8, f' transform="rotate({a} {n(x)} 72)"')
        tier += ellipse(x, 72.3, 1.6, 1.1, '#5a3925', 0, f' transform="rotate({a} {n(x)} 72.3)"')
    tier += schattiert(s, kopf, FELL, -3, -2.4)
    tier += glanz('M55.6 76.4 Q58.6 72.6 64 72.4', 1.5)
    tier += linie('M61.2 75.2 l0.9 -1.7 M64.2 74.7 l0.7 -1.8 M67.2 75.2 l0.4 -1.7', 1.1, None, 0.45)
    # the snout's bridge, then the eyes: half closed under a heavy lid
    tier += linie('M60.2 82.5 Q59.4 85 59.6 87 M67.8 82.5 Q68.6 85 68.4 87', 1.1, None, 0.4)
    for x in (57.4, 70.6):
        tier += pfad(f'M{n(x - 2)} 78.6 Q{n(x)} 81.4 {n(x + 2)} 78.6 Z', T, 0)
        tier += linie(f'M{n(x - 2.5)} 78.5 Q{n(x)} 77.3 {n(x + 2.5)} 78.5', 1.4)
        tier += kreis(x - 0.5, 79.4, 0.45, HELL, 0)
    tier += pfad(nase, SCHNAUZE[1], 1.6)
    tier += glanz('M59.6 88 Q61.6 87.3 64 87.3', 1.1)
    tier += linie('M59.4 90.2 Q60.6 89.2 62.2 89.6 M68.6 90.2 Q67.4 89.2 65.8 89.6', 1.3)
    tier += linie('M64 93 L64 95.4 M64 95.4 Q62.4 96.9 60.6 96.4 M64 95.4 Q65.6 96.9 67.4 96.4', 1.3)
    for x in (57.2, 70.8):
        tier += ellipse(x, 105.6, 4.1, 2.4, FELL[1], 1.6)
        tier += linie(f'M{n(x - 1.5)} 104.4 L{n(x - 1.5)} 106.4 M{n(x)} 104 L{n(x)} 106.6 M{n(x + 1.5)} 104.4 L{n(x + 1.5)} 106.4', 0.9, None, 0.7)
    s += f'<g clip-path="{s.clip(oeffnung)}">{tier}</g>'
    s += pfad(oeffnung, 'none')

    if busch:
        s += schattiert(s, gebuesch, GRUEN, -3, -3)
        s += linie('M18 101.5 Q21 99 24 100.5 M27 96 Q30 94 33 95.5 M30.5 103.5 Q33.5 101.5 36.5 103', 1.3, GRUEN[1])
        s += glanz('M14.5 100 Q16 97.3 19 97', 1.4) + glanz('M23.5 92.5 Q26.5 90.4 29.5 91.6', 1.4)
        s += s.schraffur(gebuesch, 'M29 109.5 L36.5 102 M33.5 110 L40 103.5', 1.1, 0.6)

    # roof: lit left slope, shaded right slope, its underside darker
    s += pfad(dach_l, ZIEGEL[0]) + pfad(dach_r, ZIEGEL[1])
    s += flaeche(P([(21, 71), (64, 35), (64, 30.8), (19.1, 68.4)]), dunkler(ZIEGEL[0], 0.2))
    s += flaeche(P([(64, 35), (107, 71), (108.9, 68.4), (64, 30.8)]), dunkler(ZIEGEL[1], 0.28))
    s += pfad(dach, 'none') + linie('M64 22 L64 35', 2)
    s += glanz('M19.5 61.2 L61.5 26.2', 1.8)
    return s


def datei(s, grund='creme', seed=5):
    """The 1024 master: the rounded background (icons.cjs squares it for the systems that round by themselves) and the drawing scaled up."""
    hinten, scheibe = GRUND[grund]
    svg = s.svg(seed)
    kern = svg[svg.index('<defs>'):svg.rindex('</svg>')]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="228" fill="{hinten}"/>'
            f'<g transform="scale(8)"><circle cx="64" cy="60" r="50" fill="{scheibe}"/>{kern}</g></svg>\n')


if __name__ == '__main__':
    with open(sys.argv[1], 'w') as f:
        f.write(datei(logo(), sys.argv[2] if len(sys.argv) > 2 else 'creme'))
