# Mietshaus symbol style ("Cel-Shading nach Rivian/Borderlands") – the rules every symbol follows:
#  - 128 x 128, light from the upper left; objects in three-quarter view where depth helps.
#  - every colour in two tones: lit and shadow, with hard edges (no gradients); top faces a third, lighter tone.
#  - heavy ink silhouette (8 px stroke under everything = about 4 px outside), inner lines 2 px, details 1.4 px.
#  - hatching only in the deepest shadows; a pale highlight line on lit edges; a soft ground shadow under objects.
#  - a slight hand-made wobble on all lines (displacement filter), so nothing looks machine-perfect.
from math import cos, sin, radians, hypot

T = '#1f1c19'          # ink
HELL = '#fffaf0'       # highlight lines

PAPIER = ('#f8f2e4', '#d9ccb2')
SAND = ('#f2ddb3', '#cdb07c')
ZIEGEL = ('#ea6a38', '#b5461e')
HOLZ = ('#cf8e55', '#9a6030')
GELB = ('#f8c443', '#d0901d')
ORANGE = ('#f38d3d', '#c5621e')
ROT = ('#e45640', '#a93725')
GRUEN = ('#5cc07c', '#36905a')
PETROL = ('#2fb7a6', '#1d877b')
HIMMEL = ('#63bdec', '#3a8cc2')
VIOLETT = ('#9b86ec', '#6c57c6')
STAHL = ('#a9bccb', '#6f8696')
ANTHRAZIT = ('#525c63', '#30373c')
MESSING = ('#efbf55', '#b9892c')
ROSE = ('#f4a49a', '#cc7568')
HAUT = ('#f3c79c', '#d29a6a')
LEDER = ('#b8794b', '#87512b')
GLAS = '#3c6e8c'
GLAS_LICHT = '#a7d8ee'


def heller(farbe, f=0.28):
    r, g, b = (int(farbe[i:i + 2], 16) for i in (1, 3, 5))
    return '#%02x%02x%02x' % tuple(round(c + (255 - c) * f) for c in (r, g, b))


def dunkler(farbe, f=0.25):
    r, g, b = (int(farbe[i:i + 2], 16) for i in (1, 3, 5))
    return '#%02x%02x%02x' % tuple(round(c * (1 - f)) for c in (r, g, b))


def n(x):
    return f'{x:.1f}'.rstrip('0').rstrip('.')


def P(punkte, zu=True):
    return 'M' + ' L'.join(f'{n(x)} {n(y)}' for x, y in punkte) + (' Z' if zu else '')


def pfad(d, fill, sw=2, extra=''):
    return f'<path d="{d}" fill="{fill}" stroke-width="{sw}"{extra}/>'


def flaeche(d, fill, op=None, extra=''):
    o = f' fill-opacity="{op}"' if op is not None else ''
    return f'<path d="{d}" fill="{fill}" stroke="none"{o}{extra}/>'


def linie(d, sw=1.6, farbe=None, op=None, extra=''):
    s = f' stroke="{farbe}"' if farbe else ''
    o = f' stroke-opacity="{op}"' if op is not None else ''
    return f'<path d="{d}" fill="none" stroke-width="{sw}"{s}{o}{extra}/>'


def glanz(d, sw=1.8):
    return linie(d, sw, HELL, 0.9)


def kreis(cx, cy, r, fill, sw=2, extra=''):
    return f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="{fill}" stroke-width="{sw}"{extra}/>'


def ellipse(cx, cy, rx, ry, fill, sw=2, extra=''):
    return f'<ellipse cx="{n(cx)}" cy="{n(cy)}" rx="{n(rx)}" ry="{n(ry)}" fill="{fill}" stroke-width="{sw}"{extra}/>'


def rechteck(x, y, w, h, fill, rx=0, sw=2, extra=''):
    return f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}" rx="{n(rx)}" fill="{fill}" stroke-width="{sw}"{extra}/>'


def boden(cx, cy, rx, ry, op=0.2):
    return f'<ellipse cx="{n(cx)}" cy="{n(cy)}" rx="{n(rx)}" ry="{n(ry)}" fill="{T}" fill-opacity="{op}" stroke="none"/>'


def punkt(cx, cy, a, r):
    return (cx + r * cos(radians(a)), cy + r * sin(radians(a)))


def bogen(cx, cy, r, a1, a2):
    (x1, y1), (x2, y2) = punkt(cx, cy, a1, r), punkt(cx, cy, a2, r)
    gross = 1 if (a2 - a1) % 360 > 180 else 0
    return f'M{n(x1)} {n(y1)} A{n(r)} {n(r)} 0 {gross} 1 {n(x2)} {n(y2)}'


def sektor(cx, cy, r, a1, a2):
    (x1, y1), (x2, y2) = punkt(cx, cy, a1, r), punkt(cx, cy, a2, r)
    gross = 1 if (a2 - a1) % 360 > 180 else 0
    return f'M{n(cx)} {n(cy)} L{n(x1)} {n(y1)} A{n(r)} {n(r)} 0 {gross} 1 {n(x2)} {n(y2)} Z'


def ring(cx, cy, r, ri):
    """A disc with a real hole (fill-rule evenodd)."""
    return (f'M{n(cx - r)} {n(cy)} A{n(r)} {n(r)} 0 1 0 {n(cx + r)} {n(cy)} A{n(r)} {n(r)} 0 1 0 {n(cx - r)} {n(cy)} Z '
            f'M{n(cx - ri)} {n(cy)} A{n(ri)} {n(ri)} 0 1 1 {n(cx + ri)} {n(cy)} A{n(ri)} {n(ri)} 0 1 1 {n(cx - ri)} {n(cy)} Z')


def pfeil(x1, y1, x2, y2, schaft=5, kopf=14, breite=12):
    lx, ly = x2 - x1, y2 - y1
    l = hypot(lx, ly)
    ux, uy = lx / l, ly / l
    nx, ny = -uy, ux
    bx, by = x2 - ux * kopf, y2 - uy * kopf
    return P([(x1 + nx * schaft, y1 + ny * schaft), (bx + nx * schaft, by + ny * schaft), (bx + nx * breite, by + ny * breite), (x2, y2),
              (bx - nx * breite, by - ny * breite), (bx - nx * schaft, by - ny * schaft), (x1 - nx * schaft, y1 - ny * schaft)])


def quader(x, y, w, h, d, farbe, oben=None, sw=2):
    """A box in three-quarter view: lit front, shaded right side, lighter top. Returns (markup, silhouette, side-point function)."""
    dx, dy = d * 0.72, -d * 0.42
    front = P([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
    seite = P([(x + w, y), (x + w + dx, y + dy), (x + w + dx, y + h + dy), (x + w, y + h)])
    deckel = P([(x, y), (x + dx, y + dy), (x + w + dx, y + dy), (x + w, y)])
    sil = P([(x, y + h), (x, y), (x + dx, y + dy), (x + w + dx, y + dy), (x + w + dx, y + h + dy), (x + w, y + h)])
    body = pfad(front, farbe[0], sw) + pfad(seite, farbe[1], sw) + pfad(deckel, oben or heller(farbe[0]), sw)

    def seitenpunkt(u, v):  # u: 0 = front edge … 1 = back edge, v: 0 = top … 1 = bottom
        return (x + w + u * dx, y + v * h + u * dy)
    return body, sil, seitenpunkt


def muenze(cx, cy, rx, ry, h, farbe=MESSING):
    seite = f'M{n(cx - rx)} {n(cy)} L{n(cx - rx)} {n(cy + h)} A{n(rx)} {n(ry)} 0 0 0 {n(cx + rx)} {n(cy + h)} L{n(cx + rx)} {n(cy)} Z'
    body = (pfad(seite, farbe[1]) + ellipse(cx, cy, rx, ry, farbe[0]) +
            ellipse(cx, cy, rx * 0.68, ry * 0.68, 'none', 1.4, ' stroke-opacity=".55"') +
            glanz(f'M{n(cx - rx * 0.8)} {n(cy - ry * 0.25)} Q{n(cx - rx * 0.55)} {n(cy - ry * 0.85)} {n(cx - rx * 0.1)} {n(cy - ry * 0.95)}', 1.6))
    kontur = [seite, f'<ellipse cx="{n(cx)}" cy="{n(cy)}" rx="{n(rx)}" ry="{n(ry)}"/>']
    return body, kontur


def euro(cx, cy, s, farbe):
    """The euro sign, inked: black under, colour on top."""
    c = bogen(cx, cy, s, 40, 320)
    stege = f'M{n(cx - s * 1.25)} {n(cy - s * 0.3)} L{n(cx + s * 0.3)} {n(cy - s * 0.3)} M{n(cx - s * 1.25)} {n(cy + s * 0.3)} L{n(cx + s * 0.15)} {n(cy + s * 0.3)}'
    return (linie(c, s * 0.62, T) + linie(stege, s * 0.5, T) + linie(c, s * 0.34, farbe) + linie(stege, s * 0.26, farbe))


def haken(d, farbe, sw=4):
    return linie(d, sw + 3.2, T) + linie(d, sw, farbe)


class Symbol:
    def __init__(self):
        self.kontur, self.teile, self.defs, self.unten = [], [], [], []
        self.nr = 0

    def k(self, *formen):
        self.kontur.extend(formen)
        return self

    def __iadd__(self, markup):
        self.teile.append(markup)
        return self

    def clip(self, d):
        self.nr += 1
        cid = f'c{self.nr}'
        self.defs.append(f'<clipPath id="{cid}"><path d="{d}"/></clipPath>')
        return f'url(#{cid})'

    def schraffur(self, gebiet, striche, sw=1.2, op=0.7):
        return f'<g clip-path="{self.clip(gebiet)}">' + linie(striche, sw, None, op) + '</g>'

    def svg(self, seed=7):
        k = ''.join(f if f.startswith('<') else f'<path d="{f}"/>' for f in self.kontur)
        return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs>'
                f'<filter id="h" x="-6%" y="-6%" width="112%" height="112%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="{seed}"/>'
                '<feDisplacementMap in="SourceGraphic" scale="1.4" xChannelSelector="R" yChannelSelector="G"/></filter>'
                + ''.join(self.defs) + '</defs>'
                f'<g stroke="{T}" stroke-linejoin="round" stroke-linecap="round" filter="url(#h)">'
                + ''.join(self.unten) + f'<g fill="{T}" stroke-width="8">{k}</g>' + ''.join(self.teile) + '</g></svg>')
