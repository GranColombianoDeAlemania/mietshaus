# All Mietshaus symbols in the cel-shading style (see stil.py). Run from this folder: python3 symbole.py ../../public/symbole
import sys, os
from stil import *


def cockpit():
    s = Symbol()
    cx, cy = 64, 68
    s.k(f'<circle cx="{cx}" cy="{cy}" r="50"/>')
    s += kreis(cx, cy, 50, heller(STAHL[0], 0.35))
    s += linie(bogen(cx, cy, 46, 15, 150), 8, STAHL[1])
    s += glanz(bogen(cx, cy, 46, 195, 255), 2.2)
    s += kreis(cx, cy, 41, ANTHRAZIT[1])
    s += flaeche(sektor(cx, cy, 40, 20, 160), T, 0.25)
    for a1, a2, f in ((150, 250, GRUEN[0]), (250, 320, GELB[0]), (320, 390, ROT[0])):
        s += linie(bogen(cx, cy, 33, a1, a2), 7, f)
    for a in range(150, 391, 30):
        (x1, y1), (x2, y2) = punkt(cx, cy, a, 23), punkt(cx, cy, a, 27)
        s += linie(f'M{n(x1)} {n(y1)} L{n(x2)} {n(y2)}', 2, HELL)
    tip = punkt(cx, cy, 300, 31)
    l, r = punkt(cx, cy, 210, 4), punkt(cx, cy, 30, 4)
    s += pfad(P([l, tip, r]), ORANGE[0], 1.6)
    s += kreis(cx, cy, 6.5, STAHL[0])
    s += rechteck(51, 84, 26, 11, '#9fe6c6', 2.5, 1.6)
    s += linie('M55 89.5 L64 89.5', 1.6, '#2f6b55')
    return s


def aufgaben():
    s = Symbol()
    s.k('<rect x="27" y="22" width="74" height="96" rx="7"/>', P([(46, 26), (82, 26), (80, 39), (48, 39)]), '<rect x="55" y="13" width="18" height="16" rx="5"/>')
    s += rechteck(27, 22, 74, 96, HOLZ[0], 7)
    s += flaeche(P([(90, 24), (99, 24), (99, 116), (90, 116)]), HOLZ[1])
    s += glanz('M31 30 L31 108')
    s += rechteck(35, 34, 58, 78, PAPIER[0], 1.5)
    s += flaeche(P([(62, 111), (92, 81), (92, 111)]), PAPIER[1])
    s += rechteck(35, 34, 58, 78, 'none', 1.5)
    s += pfad(P([(46, 26), (82, 26), (80, 39), (48, 39)]), STAHL[0])
    s += rechteck(55, 13, 18, 16, heller(STAHL[0], 0.3), 5)
    s += kreis(64, 20, 3.2, ANTHRAZIT[1], 1.6)
    s += flaeche(P([(68, 27), (80, 27), (79, 38), (66, 38)]), STAHL[1])
    for i, y in enumerate((52, 70, 88)):
        s += rechteck(42, y - 6, 12, 12, '#ffffff', 2, 1.8)
        if i < 2:
            s += haken(f'M44.5 {y} L48 {y + 4} L57 {y - 8}', GRUEN[0], 3.4)
        s += linie(f'M60 {y - 2} L86 {y - 2}', 2.2)
        s += linie(f'M60 {y + 3.5} L77 {y + 3.5}', 1.4, None, 0.7)
    return s


def objekte():
    s = Symbol()
    s.unten.append(boden(84, 112, 40, 6))
    kamin = [P([(78, 40), (78, 22), (86, 20.5), (86, 38)]), P([(86, 20.5), (91, 22), (91, 37), (86, 38)]), P([(77, 22), (86, 20), (92, 21.5), (83, 23.5)])]
    seite = P([(62, 66), (106, 57), (106, 102), (62, 113)])
    front = P([(17, 64), (40, 38), (62, 66), (62, 113), (17, 106)])
    dach = P([(40, 36), (89, 27), (114, 57), (66, 68)])
    blende = P([(40, 36), (12, 66), (16.5, 69), (41.5, 41.5), (66, 68), (69, 63.5)])
    s.k(*kamin, seite, front, dach, blende)
    s += pfad(kamin[0], ZIEGEL[0]) + pfad(kamin[1], ZIEGEL[1]) + pfad(kamin[2], heller(ZIEGEL[0]))
    s += pfad(seite, SAND[1])
    s += flaeche(P([(62, 66), (106, 57), (106, 64), (62, 74)]), dunkler(SAND[1], 0.22))
    s += s.schraffur(seite, 'M66 108 L74 100 M71 109 L81 99 M77 108 L87 98 M83 106 L93 96 M90 104 L99 96 M96 102 L105 94')
    for (a, b) in (((70, 76), (82, 73.5)), ((90, 71.5), (101, 69))):
        s += pfad(P([a, b, (b[0], b[1] + 15.5), (a[0], a[1] + 16)]), GLAS)
        s += linie(f'M{a[0] + 2.5} {a[1] + 11} L{b[0] - 3} {b[1] + 6.5}', 1.6, GLAS_LICHT)
    s += pfad(front, SAND[0])
    s += f'<g clip-path="{s.clip(front)}">' + flaeche(P([(17, 64), (40, 38), (62, 66), (62, 71), (40, 44.5), (17, 69.5)]), SAND[1]) + '</g>'
    s += pfad(P([(24, 76), (38, 77), (38, 93), (24, 92)]), GLAS)
    s += flaeche(P([(24, 76), (38, 77), (38, 80), (24, 79)]), T, 0.55)
    s += linie('M31 76.5 L31 92.5', 1.6) + linie('M26.5 89 L29.5 84 M33.5 89 L36 85', 1.5, GLAS_LICHT)
    s += pfad(P([(44, 85), (56, 86), (56, 112), (44, 110.5)]), PETROL[0])
    s += flaeche(P([(51, 85.6), (56, 86), (56, 112), (51, 111.3)]), PETROL[1])
    s += pfad(P([(44, 85), (56, 86), (56, 112), (44, 110.5)]), 'none')
    s += kreis(53.3, 99.5, 1.2, MESSING[0], 0)
    s += pfad(dach, ZIEGEL[0])
    s += flaeche(P([(78, 40), (91, 37.5), (102, 50), (90, 52.5)]), ZIEGEL[1])
    s += linie('M60 60 L108 49.5 M54 52.5 L101 42 M48 44.5 L95 34.5', 1.3, ZIEGEL[1])
    s += pfad(blende, dunkler(ZIEGEL[1], 0.3))
    s += linie('M42 34.5 L88 26', 1.8, heller(ZIEGEL[0], 0.45))
    return s


def steckbrief():
    s = Symbol()
    karte = 'M20 30 L108 30 Q114 30 114 36 L114 96 Q114 102 108 102 L20 102 Q14 102 14 96 L14 36 Q14 30 20 30 Z'
    s.k(karte)
    s += pfad(karte, PAPIER[0])
    c = s.clip(karte)
    s += f'<g clip-path="{c}">' + flaeche(P([(62, 102), (114, 58), (114, 102)]), PAPIER[1]) + flaeche(P([(14, 30), (114, 30), (114, 45), (14, 45)]), ORANGE[0]) + '</g>'
    s += linie('M14 45 L114 45', 2)
    s += pfad(karte, 'none')
    s += kreis(104, 37.5, 3.6, ROT[0], 1.6)
    s += rechteck(22, 52, 34, 40, HIMMEL[0], 2)
    s += flaeche(P([(22, 84), (56, 80), (56, 92), (22, 92)]), GRUEN[0])
    s += pfad(P([(29, 84), (29, 70), (39, 61), (49, 70), (49, 84)]), SAND[0], 1.5)
    s += pfad(P([(26, 71), (39, 59), (52, 71)], False), 'none', 2.4)
    s += pfad(P([(36, 84), (36, 76), (42, 76), (42, 84)]), PETROL[0], 1.4)
    s += rechteck(22, 52, 34, 40, 'none', 2)
    s += linie('M64 58 L104 58', 2.4) + linie('M64 68 L98 68 M64 77 L92 77 M64 86 L100 86', 1.6, None, 0.75)
    return s


def einheiten():
    s = Symbol()
    s.unten.append(boden(76, 112, 42, 6))
    body, sil, sp = quader(26, 38, 48, 74, 34, ('#f4b277', '#c98549'), '#a9b6bf')
    s.k(sil)
    s += body
    s += s.schraffur(P([sp(0, 0.7), sp(1, 0.7), sp(1, 1), sp(0, 1)]), 'M76 108 L84 100 M80 109 L92 97 M86 108 L98 96 M92 106 L100 98')
    for col in (32, 46, 60):
        for row in (46, 62, 78):
            s += rechteck(col, row, 9, 10, GLAS, 1, 1.6)
            s += linie(f'M{col + 2} {row + 8} L{col + 6} {row + 3}', 1.3, GLAS_LICHT)
    s += pfad(P([(45, 96), (55, 96), (55, 112), (45, 112)]), PETROL[0], 1.8)
    s += flaeche(P([(50.5, 96), (55, 96), (55, 112), (50.5, 112)]), PETROL[1])
    for u in (0.18, 0.58):
        for v in (0.1, 0.32, 0.54):
            a, b, c, d = sp(u, v), sp(u + 0.24, v), sp(u + 0.24, v + 0.13), sp(u, v + 0.13)
            s += pfad(P([a, b, c, d]), dunkler(GLAS, 0.15), 1.6)
    s += pfad(P([(26, 38), (74, 38), (74, 43), (26, 43)]), dunkler('#f4b277', 0.18), 1.6)
    s += glanz('M29 40 L50 40', 1.6)
    return s


def mieter():
    s = Symbol()
    # two busts: head, neck, shoulders with a collar – the back one teal, the front one orange
    leute = ((82, 44, 13, 'M56 110 C56 66 108 66 108 110 Z', 77, PETROL, '#c98a3a'),
             (48, 54, 15.5, 'M16 122 C16 72 80 72 80 122 Z', 84.5, ORANGE, '#5a3a26'))
    for kx, ky, kr, schultern, oben, hemd, haar in leute:
        hals = P([(kx - 5.5, ky + kr - 4), (kx + 5.5, ky + kr - 4), (kx + 5.5, oben + 6), (kx - 5.5, oben + 6)])
        s.k(hals, schultern, f'<circle cx="{kx}" cy="{ky}" r="{kr}"/>')
    for kx, ky, kr, schultern, oben, hemd, haar in leute:
        s += pfad(P([(kx - 5.5, ky + kr - 4), (kx + 5.5, ky + kr - 4), (kx + 5.5, oben + 6), (kx - 5.5, oben + 6)]), HAUT[1])
        s += pfad(schultern, hemd[0])
        s += f'<g clip-path="{s.clip(schultern)}">' + flaeche(f'M{kx} 60 L130 60 L130 130 L{kx} 130 Z', hemd[1]) + '</g>'
        s += pfad(schultern, 'none')
        s += pfad(P([(kx - 8, oben + 1), (kx, oben + 9), (kx + 8, oben + 1)], False), 'none', 1.8)
        s += kreis(kx, ky, kr, HAUT[0])
        s += f'<g clip-path="{s.clip(f"M{kx} {ky - kr - 2} L{kx + kr + 2} {ky - kr - 2} L{kx + kr + 2} {ky + kr + 2} L{kx} {ky + kr + 2} Z")}">' + kreis(kx + 3, ky, kr, HAUT[1], 0) + '</g>'
        s += kreis(kx, ky, kr, 'none')
        s += pfad(f'M{kx - kr} {ky - 1} C{kx - kr} {ky - kr - 6} {kx + kr} {ky - kr - 6} {kx + kr} {ky - 1} C{kx + kr * 0.4} {ky - kr * 0.55} {kx - kr * 0.4} {ky - kr * 0.55} {kx - kr} {ky - 1} Z', haar, 1.8)
    return s


def zaehler():
    s = Symbol()
    s.k('<rect x="6" y="61" width="26" height="15" rx="3"/>', '<rect x="96" y="61" width="26" height="15" rx="3"/>', '<circle cx="64" cy="68" r="37"/>')
    for x in (6, 96):
        s += rechteck(x, 61, 26, 15, STAHL[0], 3)
        s += flaeche(P([(x, 70), (x + 26, 70), (x + 26, 76), (x, 76)]), STAHL[1])
    s += kreis(64, 68, 37, MESSING[0])
    s += linie(bogen(64, 68, 33, 10, 160), 7, MESSING[1])
    s += glanz(bogen(64, 68, 33, 200, 260), 2.2)
    s += kreis(64, 68, 27, '#f8f6ef')
    s += flaeche(sektor(64, 68, 26, 20, 150), PAPIER[1])
    s += rechteck(43, 53, 42, 13, T, 2, 1.6)
    for i, x in enumerate((46, 55.5, 65, 74.5)):
        s += rechteck(x, 55.5, 7.5, 8, ROT[0] if i == 3 else '#fbf7ec', 1, 0)
    s += kreis(64, 82, 6.5, '#ffffff', 1.6)
    s += linie('M64 82 L68 78', 1.8, ROT[0])
    s += glanz('M44 74 Q46 82 52 87', 1.6)
    return s


def umlage():
    s = Symbol()
    cx, cy, r, d = 60, 58, 40, 9
    teile = ((200, 340, GELB), (340, 445, HIMMEL), (85, 160, GRUEN))
    for a1, a2, f in teile:
        s.k(sektor(cx, cy + d, r, a1, a2), sektor(cx, cy, r, a1, a2))
    s.k(sektor(cx - 9, cy + d, r, 160, 200), sektor(cx - 9, cy, r, 160, 200))
    for a1, a2, f in teile:
        s += pfad(sektor(cx, cy + d, r, a1, a2), f[1])
    s += pfad(sektor(cx - 9, cy + d, r, 160, 200), ORANGE[1])
    for a1, a2, f in teile:
        s += pfad(sektor(cx, cy, r, a1, a2), f[0])
    s += pfad(sektor(cx - 9, cy, r, 160, 200), ORANGE[0])
    s += glanz(bogen(cx, cy, r - 5, 215, 265), 2)
    s += s.schraffur(sektor(cx, cy + d, r, 0, 85), 'M96 74 L90 84 M92 82 L84 92 M86 88 L78 98', 1.2, 0.6)
    return s


def adressbuch():
    s = Symbol()
    reiter = [(36, ORANGE), (54, GELB), (72, ROT)]
    s.k('<rect x="28" y="18" width="70" height="96" rx="5"/>', *[f'<rect x="94" y="{y}" width="14" height="13" rx="3"/>' for y, _ in reiter])
    for y, f in reiter:
        s += rechteck(94, y, 14, 13, f[0], 3)
        s += flaeche(P([(101, y + 1), (107, y + 1), (107, y + 12), (101, y + 12)]), f[1])
    s += rechteck(28, 18, 70, 96, PETROL[0], 5)
    s += flaeche(P([(28, 22), (40, 22), (40, 110), (28, 110)]), PETROL[1])
    s += flaeche(P([(84, 18), (98, 18), (98, 114), (70, 114)]), PETROL[1], 0.55)
    s += linie('M40 19 L40 113', 2)
    s += rechteck(28, 18, 70, 96, 'none', 5)
    s += rechteck(50, 34, 38, 30, PAPIER[0], 3, 1.8)
    s += kreis(69, 44, 5.5, ANTHRAZIT[0], 1.4)
    s += pfad('M58 61 C58 51 80 51 80 61 Z', ANTHRAZIT[0], 1.4)
    s += linie('M50 78 L88 78 M50 86 L80 86', 1.6, heller(PETROL[0], 0.5))
    s += glanz('M44 24 L44 106', 1.6)
    return s


def postfach():
    s = Symbol()
    s.unten.append(flaeche(P([(80, 106), (108, 96), (118, 100), (90, 111)]), T, 0.22))
    seite = P([(80, 50), (108, 42), (108, 96), (80, 106)])
    front = P([(20, 44), (80, 50), (80, 106), (20, 100)])
    deckel_oben = P([(17, 42), (52, 33), (111, 39.5), (82, 48.5)])
    deckel_vorn = P([(17, 42), (82, 48.5), (82, 53), (17, 46.5)])
    deckel_seite = P([(82, 48.5), (111, 39.5), (111, 44), (82, 53)])
    brief = P([(37, 66), (41, 47), (69, 52), (66, 70)])
    s.k(seite, front, deckel_oben, deckel_vorn, deckel_seite, brief)
    s += pfad(seite, GELB[1])
    s += s.schraffur(seite, 'M83 103 L90 95 M87 103 L96 93 M93 102 L102 92 M99 100 L107 91', 1.3, 0.65)
    s += pfad(front, GELB[0])
    s += f'<g clip-path="{s.clip(front)}">' + flaeche(P([(20, 44), (80, 50), (80, 57), (20, 51)]), GELB[1]) + '</g>'
    s += pfad(front, 'none')
    s += pfad(deckel_oben, heller(ANTHRAZIT[0], 0.2)) + pfad(deckel_vorn, ANTHRAZIT[0]) + pfad(deckel_seite, ANTHRAZIT[1])
    s += glanz('M22 41.5 L50 34.5', 1.6)
    s += pfad(brief, PAPIER[0])
    s += flaeche(P([(55, 49.5), (69, 52), (66, 70), (58, 68.7)]), PAPIER[1])
    s += pfad(brief, 'none') + linie('M41 47 L54 60 L69 52', 1.5)
    s += pfad(P([(58, 51), (66, 52.4), (65.2, 58.5), (57.2, 57.2)]), ROT[0], 1.4)
    s += pfad(P([(31, 64), (71, 68), (71, 74), (31, 70)]), T)
    s += pfad(P([(38, 82), (62, 84.5), (62, 93), (38, 90.5)]), PAPIER[0])
    s += linie('M42 86.5 L56 88', 1.3)
    return s


def vorschlaege():
    s = Symbol()
    birne = 'M44 64 C40 50 46 22 64 22 C82 22 88 50 84 64 C81 72 76 76 76 84 L52 84 C52 76 47 72 44 64 Z'
    sockel = [(52, 84, 24, GELB), (53, 90, 22, None), (55, 96, 18, None)]
    s.k(birne, '<rect x="52" y="84" width="24" height="18" rx="2"/>', '<rect x="57" y="100" width="14" height="9" rx="3"/>')
    s += pfad(birne, '#fbe27a')
    s += f'<g clip-path="{s.clip(birne)}">' + flaeche('M66 18 C90 22 92 56 82 70 C78 76 76 80 76 86 L64 86 Z', GELB[0]) + '</g>'
    s += pfad(birne, 'none')
    s += linie('M58 78 L58 62 M70 78 L70 62', 1.6, STAHL[1]) + linie('M58 62 Q59.5 56 61 62 Q62.5 68 64 62 Q65.5 56 67 62 Q68.5 68 70 62', 2, ORANGE[1])
    s += glanz('M50 50 C49 40 54 31 61 29', 2.2)
    for i, y in enumerate((84, 90, 96)):
        s += rechteck(52 + (i > 1) * 2, y, 24 - (i > 1) * 4, 6, STAHL[0] if i % 2 == 0 else STAHL[1], 1.5, 1.8)
    s += rechteck(57, 101, 14, 8, ANTHRAZIT[0], 3, 1.8)
    for (x, y, g, f) in ((24, 34, 9, VIOLETT[0]), (101, 28, 7, VIOLETT[0]), (104, 62, 5, VIOLETT[1]), (24, 70, 4.5, VIOLETT[1])):
        stern = f'M{x} {y - g} Q{x} {y} {x + g} {y} Q{x} {y} {x} {y + g} Q{x} {y} {x - g} {y} Q{x} {y} {x} {y - g} Z'
        s += pfad(stern, f, 1.8)
    return s


def archiv():
    s = Symbol()
    s.unten.append(boden(70, 110, 46, 6))
    kiste, ksil, sp = quader(20, 56, 66, 50, 32, ('#dca368', '#ac7541'))
    deckel, dsil, _ = quader(16.5, 46, 73, 12, 35, ('#c98f55', '#9a6431'), '#ecc28e')
    s.k(ksil, dsil)
    s += kiste
    s += s.schraffur(P([sp(0, 0.5), sp(1, 0.5), sp(1, 1), sp(0, 1)]), 'M88 100 L96 92 M92 102 L104 90 M98 98 L108 88', 1.2, 0.6)
    s += deckel
    s += rechteck(40, 65, 26, 8, T, 4, 1.6)
    s += rechteck(32, 80, 42, 18, PAPIER[0], 2, 1.8)
    s += linie('M37 86 L68 86 M37 92 L58 92', 1.5)
    s += glanz('M20 48 L50 48', 1.6)
    return s


def rechnungen():
    s = Symbol()
    zack = [(92, 104)]
    x = 92
    while x > 36:
        x -= 7
        zack.append((max(x + 3.5, 36), 110 if len(zack) % 2 else 104))
    zack.append((36, 104))
    bon = P([(36, 14), (92, 14)] + zack)
    g = '<g transform="rotate(-6 64 62)">'
    s.k(f'<path transform="rotate(-6 64 62)" d="{bon}"/>')
    s += g + pfad(bon, PAPIER[0])
    s += f'<g clip-path="{s.clip(bon)}">' + flaeche(P([(56, 112), (92, 60), (92, 112)]), PAPIER[1]) + '</g>'
    s += pfad(bon, 'none')
    s += euro(60, 40, 12, ORANGE[0])
    s += linie('M44 66 L84 66 M44 74 L78 74 M44 82 L84 82', 1.6, None, 0.75)
    s += linie('M58 93 L84 93', 2.8)
    s += '</g>'
    return s


def buchungen():
    s = Symbol()
    umschlag = 'M10 44 L64 54 L118 44 L118 104 L64 116 L10 104 Z'
    links = 'M15 38 C33 31 51 35 64 46 L64 110 C51 100 33 97 15 101 Z'
    rechts = 'M113 38 C95 31 77 35 64 46 L64 110 C77 100 95 97 113 101 Z'
    s.k(umschlag, links, rechts)
    s += pfad(umschlag, PETROL[1])
    s += pfad(links, PAPIER[0]) + pfad(rechts, '#ece2cc')
    s += f'<g clip-path="{s.clip(rechts)}">' + flaeche('M64 46 C70 52 72 80 64 110 L60 110 L60 46 Z', T, 0.18) + '</g>'
    for i in range(5):
        y = 52 + i * 11
        s += linie(f'M22 {y - 4 + i * 0.2} Q42 {y - 7} 60 {y + 1}', 1.3, None, 0.6)
        s += linie(f'M106 {y - 4 + i * 0.2} Q86 {y - 7} 68 {y + 1}', 1.3, None, 0.6)
    s += linie('M48 40 L48 104', 1.4, ROT[0]) + linie('M98 37 L98 99', 1.4, ROT[0])
    s += pfad(P([(70, 44), (77, 44), (77, 122), (73.5, 117), (70, 122)]), ROT[0], 1.8)
    s += glanz('M20 40 C34 35 48 37 58 44', 1.6)
    return s


def konten():
    s = Symbol()
    giebel = P([(14, 48), (64, 18), (114, 48), (114, 56), (14, 56)])
    stufen = [P([(14, 98), (114, 98), (114, 106), (14, 106)]), P([(8, 106), (120, 106), (120, 114), (8, 114)])]
    saeulen = [26, 46, 72, 92]
    s.k(giebel, *stufen, *[P([(x, 56), (x + 11, 56), (x + 11, 98), (x, 98)]) for x in saeulen])
    s += pfad(giebel, '#ece0c6')
    s += flaeche(P([(64, 18), (114, 48), (114, 56), (64, 56)]), '#c9b894')
    s += pfad(giebel, 'none') + linie('M14 48 L114 48', 2)
    s += kreis(64, 37, 7, MESSING[0], 1.8) + linie('M64 33 L64 41', 1.4)
    for x in saeulen:
        s += pfad(P([(x, 56), (x + 11, 56), (x + 11, 98), (x, 98)]), '#f3e9d4')
        s += flaeche(P([(x + 6, 56), (x + 11, 56), (x + 11, 98), (x + 6, 98)]), '#cdbd99')
        s += linie(f'M{x + 3.5} 60 L{x + 3.5} 94', 1.1, None, 0.5)
    for d in stufen:
        s += pfad(d, '#d8c7a3')
    s += flaeche(P([(14, 98), (114, 98), (114, 100.5), (14, 100.5)]), T, 0.3)
    s += glanz('M20 46 L62 21', 1.8)
    return s


def sollstellung():
    s = Symbol()
    blatt = 'M24 24 L80 24 Q86 24 86 30 L86 92 Q86 98 80 98 L24 98 Q18 98 18 92 L18 30 Q18 24 24 24 Z'
    s.k(blatt, '<rect x="30" y="15" width="8" height="18" rx="3"/>', '<rect x="66" y="15" width="8" height="18" rx="3"/>')
    s += pfad(blatt, PAPIER[0])
    c = s.clip(blatt)
    s += f'<g clip-path="{c}">' + flaeche(P([(18, 24), (86, 24), (86, 40), (18, 40)]), ROT[0]) + flaeche(P([(52, 98), (86, 62), (86, 98)]), PAPIER[1]) + '</g>'
    s += linie('M18 40 L86 40', 2) + pfad(blatt, 'none')
    for x in (30, 66):
        s += rechteck(x, 15, 8, 18, STAHL[0], 3, 1.8)
    for i in range(3):
        for j in range(3):
            s += rechteck(27 + j * 17, 48 + i * 14, 11, 9, '#e6dcc6', 1.5, 0)
    s += linie(bogen(86, 86, 21, 200, 470), 11, T)
    s += linie(bogen(86, 86, 21, 200, 470), 6, PETROL[0])
    a = punkt(86, 86, 470, 21)
    s.k(P([(a[0] - 9, a[1] - 7), (a[0] + 9, a[1] - 2), (a[0] - 3, a[1] + 9)]))
    s += pfad(P([(a[0] - 9, a[1] - 7), (a[0] + 9, a[1] - 2), (a[0] - 3, a[1] + 9)]), PETROL[0], 1.8)
    s += kreis(86, 86, 10.5, MESSING[0], 2)
    s += linie('M82.5 84 L89 84 M82.5 88 L88 88', 1.4) + linie(bogen(86.5, 86, 4.5, 50, 310), 1.6)
    return s


def offene_posten():
    s = Symbol()
    blatt = P([(24, 16), (74, 16), (88, 30), (88, 112), (24, 112)])
    s.k(blatt, '<circle cx="88" cy="88" r="21"/>')
    s += pfad(blatt, PAPIER[0])
    s += f'<g clip-path="{s.clip(blatt)}">' + flaeche(P([(48, 112), (88, 66), (88, 112)]), PAPIER[1]) + '</g>'
    s += pfad(blatt, 'none') + pfad(P([(74, 16), (74, 30), (88, 30)]), PAPIER[1], 1.8)
    s += linie('M32 34 L62 34', 2.6) + linie('M32 46 L76 46 M32 55 L70 55 M32 64 L74 64', 1.5, None, 0.7)
    s += rechteck(32, 74, 26, 10, '#efe5cf', 2, 1.6)
    s += kreis(88, 88, 21, ROT[0])
    s += f'<g clip-path="{s.clip("M88 64 L112 64 L112 112 L88 112 Z")}">' + kreis(88, 88, 21, ROT[1], 0) + '</g>'
    s += kreis(88, 88, 21, 'none')
    s += rechteck(85, 74, 6, 17, '#ffffff', 2.5, 1.4) + kreis(88, 98.5, 3.2, '#ffffff', 1.4)
    return s


def bank():
    s = Symbol()
    karte = P([(14, 34), (92, 18), (104, 72), (26, 88)])
    s.k(karte, pfeil(36, 104, 104, 104, 4, 12, 9), pfeil(92, 118, 24, 118, 3.5, 11, 8))
    s += pfad(karte, HIMMEL[0])
    s += f'<g clip-path="{s.clip(karte)}">' + flaeche(P([(60, 92), (110, 60), (110, 92)]), HIMMEL[1]) + flaeche(P([(10, 44), (96, 26), (98, 36), (12, 54)]), T, 0.85) + '</g>'
    s += pfad(karte, 'none')
    s += pfad(P([(30, 60), (44, 57), (46, 66), (32, 69)]), MESSING[0], 1.6)
    s += linie('M52 70 L62 68 M66 67 L76 65 M80 64 L90 62', 2, '#eaf6fd')
    s += glanz('M20 36 L80 23', 1.6)
    s += pfad(pfeil(36, 104, 104, 104, 4, 12, 9), ORANGE[0], 1.8)
    s += pfad(pfeil(92, 118, 24, 118, 3.5, 11, 8), GRUEN[0], 1.8)
    return s


def darlehen():
    s = Symbol()
    teile = []
    for cy in (94, 82, 70):
        b, k = muenze(50, cy, 26, 9.5, 8)
        s.k(*k)
        teile.append(b)
    s.unten.append(boden(52, 108, 34, 5))
    for b in teile:
        s += b
    schild = P([(66, 20), (98, 20), (112, 34), (98, 48), (66, 48)])
    s.k(schild)
    s += pfad(schild, ORANGE[0])
    s += flaeche(P([(84, 34), (112, 34), (98, 48), (84, 48)]), ORANGE[1])
    s += pfad(schild, 'none')
    s += kreis(100, 34, 3, '#ffffff', 1.4)
    s += kreis(74, 27, 3.4, PAPIER[0], 1.5) + kreis(88, 41, 3.4, PAPIER[0], 1.5) + linie('M90 25 L72 43', 2)
    s += linie('M100 34 Q96 56 72 64', 1.6)
    return s


def betriebskosten():
    s = Symbol()
    tropfen = 'M33 36 C23 54 15 64 15 76 A18 18 0 0 0 51 76 C51 64 43 54 33 36 Z'
    flamme = 'M92 26 C106 44 112 60 110 78 C108 94 98 104 88 104 C76 104 68 94 70 82 C72 72 80 68 80 56 C86 62 88 68 88 72 C94 64 96 46 92 26 Z'
    blitz = P([(66, 46), (52, 80), (64, 80), (56, 114), (84, 70), (70, 70), (80, 46)])
    s.k(tropfen, flamme, blitz)
    s += pfad(tropfen, HIMMEL[0])
    s += f'<g clip-path="{s.clip(tropfen)}">' + flaeche('M36 30 L60 30 L60 100 L36 100 Z', HIMMEL[1]) + '</g>' + pfad(tropfen, 'none')
    s += glanz('M22 72 C22 66 25 60 29 54', 2)
    s += pfad(flamme, ORANGE[0])
    s += pfad('M90 64 C98 74 100 82 98 90 C96 98 90 100 86 100 C80 100 77 94 78 88 C80 80 86 78 88 70 Z', GELB[0], 1.6)
    s += pfad(blitz, GELB[0])
    s += f'<g clip-path="{s.clip(blitz)}">' + flaeche('M68 40 L90 40 L90 116 L62 116 Z', GELB[1]) + '</g>' + pfad(blitz, 'none')
    return s


def jahresabrechnung():
    s = Symbol()
    blatt = P([(20, 14), (70, 14), (84, 28), (84, 110), (20, 110)])
    s.k(blatt, '<circle cx="88" cy="90" r="20"/>')
    s += pfad(blatt, PAPIER[0])
    s += f'<g clip-path="{s.clip(blatt)}">' + flaeche(P([(44, 110), (84, 64), (84, 110)]), PAPIER[1]) + '</g>'
    s += pfad(blatt, 'none') + pfad(P([(70, 14), (70, 28), (84, 28)]), PAPIER[1], 1.8)
    s += linie('M28 30 L56 30', 2.6)
    for x, h, f in ((28, 26, HIMMEL), (42, 40, GRUEN), (56, 18, ORANGE)):
        s += rechteck(x, 92 - h, 10, h, f[0], 1, 1.8)
        s += flaeche(P([(x + 6, 92 - h + 1), (x + 9, 92 - h + 1), (x + 9, 91), (x + 6, 91)]), f[1])
    s += linie('M26 92.5 L72 92.5', 2)
    s += kreis(88, 90, 20, GRUEN[0])
    s += f'<g clip-path="{s.clip("M88 66 L112 66 L112 114 L88 114 Z")}">' + kreis(88, 90, 20, GRUEN[1], 0) + '</g>' + kreis(88, 90, 20, 'none')
    s += haken('M79 90 L86 97 L98 82', '#ffffff', 3.4)
    return s


def wirtschaftsplan():
    s = Symbol()
    beine = 'M42 114 L58 70 M86 114 L70 70'
    s.k(f'<path d="{beine}" stroke-width="12" fill="none"/>', '<rect x="16" y="16" width="96" height="66" rx="3"/>')
    s += linie('M64 116 L64 76', 6, T) + linie('M64 116 L64 76', 3, HOLZ[1])
    s += linie(beine, 6, HOLZ[0])
    s += rechteck(16, 16, 96, 66, HOLZ[0], 3)
    s += rechteck(22, 22, 84, 54, '#fbf8f0', 1, 1.8)
    s += flaeche(P([(70, 76), (106, 40), (106, 76)]), PAPIER[1])
    for x, h, f in ((30, 22, HIMMEL), (46, 32, GRUEN), (62, 16, GELB)):
        s += rechteck(x, 70 - h, 10, h, f[0], 1, 1.6)
    s += linie('M30 46 L50 34 L68 42 L96 28', 3, ROT[0])
    for x, y in ((50, 34), (68, 42), (96, 28)):
        s += kreis(x, y, 2.6, ROT[0], 1.4)
    s += rechteck(52, 11, 24, 7, STAHL[0], 2, 1.8)
    return s


def ruecklagen():
    s = Symbol()
    s.unten.append(boden(64, 112, 40, 5))
    beine = [(36, 96), (50, 99), (74, 99), (88, 96)]
    koerper = 'M24 78 C24 58 42 50 64 50 C86 50 104 60 104 78 C104 96 86 104 64 104 C42 104 24 96 24 78 Z'
    ohr = P([(78, 52), (88, 38), (94, 56)])
    s.k(*[f'<rect x="{x}" y="{y}" width="11" height="14" rx="3"/>' for x, y in beine], koerper, ohr, '<ellipse cx="106" cy="78" rx="7" ry="9"/>', '<ellipse cx="64" cy="38" rx="11" ry="13"/>')
    for x, y in beine:
        s += rechteck(x, y, 11, 14, ROSE[1], 3)
    b, _ = muenze(64, 38, 11, 13, 0)
    s += ellipse(64, 38, 11, 13, MESSING[0]) + ellipse(64, 38, 7, 9, 'none', 1.3, ' stroke-opacity=".55"')
    s += pfad(koerper, ROSE[0])
    s += f'<g clip-path="{s.clip(koerper)}">' + flaeche('M20 88 C40 100 90 104 108 82 L108 110 L20 110 Z', ROSE[1]) + '</g>' + pfad(koerper, 'none')
    s += pfad(ohr, ROSE[1])
    s += ellipse(106, 78, 7, 9, dunkler(ROSE[0], 0.12)) + kreis(104.5, 76, 1.3, T, 0) + kreis(107.5, 80, 1.3, T, 0)
    s += kreis(92, 70, 2.2, T, 0)
    s += linie('M54 53 L74 52', 3.2)
    s += linie('M24 74 C16 72 14 64 20 62 C24 61 25 66 21 68', 2)
    s += glanz('M34 66 C40 58 50 55 58 54', 2)
    return s


def rendite():
    s = Symbol()
    tafel = 'M20 22 L108 22 Q114 22 114 28 L114 100 Q114 106 108 106 L20 106 Q14 106 14 100 L14 28 Q14 22 20 22 Z'
    s.k(tafel)
    s += pfad(tafel, PAPIER[0])
    s += f'<g clip-path="{s.clip(tafel)}">' + flaeche(P([(70, 106), (114, 62), (114, 106)]), PAPIER[1]) + '</g>' + pfad(tafel, 'none')
    s += linie('M24 36 L24 96 L106 96', 2)
    s += linie('M24 76 L106 76 M24 56 L106 56', 1, None, 0.3)
    for x, h in ((34, 12), (52, 20), (70, 16), (88, 28)):
        s += rechteck(x, 96 - h, 9, h, HIMMEL[0], 1, 1.4)
    linie_d = 'M28 88 L48 74 L66 80 L90 50'
    s += linie(linie_d, 10, T) + linie(linie_d, 5.5, GRUEN[0])
    s += pfad(pfeil(80, 62, 100, 38, 1, 13, 10), GRUEN[0], 2)
    return s


def kaution():
    s = Symbol()
    s.unten.append(boden(72, 110, 44, 6))
    body, sil, sp = quader(22, 30, 62, 74, 34, ANTHRAZIT, heller(ANTHRAZIT[0], 0.3))
    s.k(sil, '<rect x="30" y="102" width="12" height="8" rx="2"/>', '<rect x="66" y="102" width="12" height="8" rx="2"/>')
    s += rechteck(30, 102, 12, 8, T, 2, 0) + rechteck(66, 102, 12, 8, T, 2, 0)
    s += body
    s += s.schraffur(P([sp(0, 0.55), sp(1, 0.55), sp(1, 1), sp(0, 1)]), 'M86 100 L92 92 M88 104 L100 90 M94 102 L106 88 M100 98 L108 88', 1.2, 0.7)
    s += rechteck(28, 36, 50, 62, 'none', 0, 1.6)
    s += kreis(50, 62, 13, MESSING[0])
    s += f'<g clip-path="{s.clip("M50 47 L66 47 L66 77 L50 77 Z")}">' + kreis(50, 62, 13, MESSING[1], 0) + '</g>' + kreis(50, 62, 13, 'none')
    for a in range(0, 360, 45):
        (x1, y1), (x2, y2) = punkt(50, 62, a, 9), punkt(50, 62, a, 12)
        s += linie(f'M{n(x1)} {n(y1)} L{n(x2)} {n(y2)}', 1.3)
    s += kreis(50, 62, 4, ANTHRAZIT[1], 1.6)
    s += rechteck(66, 74, 6, 16, STAHL[0], 2, 1.6)
    s += glanz('M25 33 L55 33', 1.6)
    return s


def anpassung():
    s = Symbol()
    schild = P([(14, 64), (30, 44), (74, 44), (74, 96), (30, 96)])
    hoch = P([(88, 100), (88, 60), (78, 60), (96, 30), (114, 60), (104, 60), (104, 100)])
    s.k(schild, hoch)
    s += pfad(schild, ORANGE[0])
    s += flaeche(P([(52, 96), (74, 70), (74, 96)]), ORANGE[1]) + pfad(schild, 'none')
    s += kreis(30, 66, 4.2, '#ffffff', 1.6)
    s += euro(55, 70, 10, PAPIER[0])
    s += pfad(hoch, GRUEN[0])
    s += flaeche(P([(97, 60), (104, 60), (104, 100), (97, 100)]), GRUEN[1]) + pfad(hoch, 'none')
    return s


def vermietung():
    s = Symbol()
    s.k('<rect x="22" y="16" width="11" height="100" rx="2"/>', '<rect x="22" y="22" width="78" height="10" rx="2"/>', '<rect x="36" y="46" width="62" height="42" rx="3"/>')
    s += pfad('M10 118 C16 108 24 110 28 116 C32 108 42 108 46 118 Z', GRUEN[0], 1.8)
    s += rechteck(22, 16, 11, 100, HOLZ[0], 2)
    s += flaeche(P([(28, 18), (33, 18), (33, 114), (28, 114)]), HOLZ[1])
    s += rechteck(22, 22, 78, 10, HOLZ[0], 2)
    s += flaeche(P([(22, 28), (100, 28), (100, 32), (22, 32)]), HOLZ[1])
    s += linie('M46 32 L46 46 M88 32 L88 46', 2.2)
    s += rechteck(36, 46, 62, 42, ORANGE[0], 3)
    s += flaeche(P([(70, 88), (98, 60), (98, 88)]), ORANGE[1]) + rechteck(36, 46, 62, 42, 'none', 3)
    s += pfad(P([(56, 78), (56, 66), (67, 57), (78, 66), (78, 78)]), PAPIER[0], 1.8)
    s += pfad(P([(64, 78), (64, 70), (70, 70), (70, 78)]), ORANGE[1], 1.4)
    return s


def uebergabe():
    s = Symbol()
    s.unten.append(flaeche(P([(36, 112), (84, 112), (104, 122), (24, 122)]), GELB[0], 0.45))
    rahmen = P([(30, 14), (90, 14), (90, 114), (30, 114)])
    tuer = P([(36, 20), (14, 28), (14, 120), (36, 114)])
    s.k(rahmen, tuer)
    s += pfad(rahmen, HOLZ[0])
    s += rechteck(36, 20, 48, 94, '#ffe7a6', 0, 2)
    s += flaeche(P([(36, 20), (84, 20), (84, 30), (36, 40)]), GELB[0], 0.6)
    s += flaeche(P([(84, 20), (90, 14), (90, 114), (84, 114)]), HOLZ[1])
    s += pfad(tuer, PETROL[0])
    s += flaeche(P([(14, 28), (22, 25), (22, 117), (14, 120)]), PETROL[1])
    s += pfad(tuer, 'none')
    s += pfad(P([(19, 40), (32, 36), (32, 62), (19, 66)]), 'none', 1.6) + pfad(P([(19, 76), (32, 72), (32, 104), (19, 108)]), 'none', 1.6)
    s += kreis(30, 70, 2.4, MESSING[0], 1.4)
    return s


def versammlung():
    s = Symbol()
    pult = P([(34, 60), (94, 60), (86, 114), (42, 114)])
    platte = P([(26, 50), (102, 50), (96, 62), (32, 62)])
    s.k(pult, platte, '<path d="M76 50 L90 26" stroke-width="11" fill="none"/>', '<ellipse cx="92" cy="22" rx="7" ry="8"/>')
    s += pfad(pult, HOLZ[0])
    s += flaeche(P([(70, 62), (94, 60), (86, 114), (70, 114)]), HOLZ[1]) + pfad(pult, 'none')
    s += pfad(P([(44, 70), (84, 70), (80, 104), (48, 104)]), 'none', 1.6)
    s += kreis(64, 86, 8, MESSING[0], 1.8) + linie('M60 86 L68 86', 1.4)
    s += pfad(platte, heller(HOLZ[0], 0.25))
    s += linie('M76 50 L90 26', 3.5, ANTHRAZIT[0])
    s += ellipse(92, 22, 7, 8, ANTHRAZIT[0]) + linie('M87 20 L97 20 M87 24 L97 24', 1.2, STAHL[0])
    return s


def beschluesse():
    s = Symbol()
    s.unten.append(boden(48, 108, 34, 5))
    s.k('<ellipse cx="46" cy="102" rx="27" ry="9"/>', 'M19 96 L19 102 L73 102 L73 96 Z', '<ellipse cx="46" cy="96" rx="27" ry="9"/>')
    s += pfad('M19 96 L19 102 A27 9 0 0 0 73 102 L73 96 Z', HOLZ[1])
    s += ellipse(46, 96, 27, 9, HOLZ[0])
    s += ellipse(46, 96, 18, 5.5, 'none', 1.3, ' stroke-opacity=".5"')
    g = '<g transform="rotate(-38 76 50)">'
    s.k(f'<rect transform="rotate(-38 76 50)" x="52" y="36" width="48" height="24" rx="7"/>', f'<rect transform="rotate(-38 76 50)" x="72" y="58" width="8" height="52" rx="3"/>')
    s += g + rechteck(72, 58, 8, 52, HOLZ[1], 3) + rechteck(52, 36, 48, 24, HOLZ[0], 7)
    s += flaeche(P([(52, 52), (100, 52), (100, 60), (52, 60)]), HOLZ[1])
    s += rechteck(60, 36, 5, 24, MESSING[0], 0, 1.6) + rechteck(87, 36, 5, 24, MESSING[0], 0, 1.6)
    s += rechteck(52, 36, 48, 24, 'none', 7)
    s += glanz('M58 40 L94 40', 1.6) + '</g>'
    return s


def kontakte():
    s = Symbol()
    sockel = 'M28 68 L100 68 Q104 68 106 72 L114 104 Q115 110 109 110 L19 110 Q13 110 14 104 L22 72 Q24 68 28 68 Z'
    hoerer = 'M16 56 C16 42 30 40 36 45 L92 45 C98 40 112 42 112 56 L112 62 C104 65 96 63 92 58 L36 58 C32 63 24 65 16 62 Z'
    s.k(sockel, hoerer)
    s += pfad(sockel, ROT[0])
    s += f'<g clip-path="{s.clip(sockel)}">' + flaeche('M74 64 L120 64 L120 112 L84 112 Z', ROT[1]) + '</g>' + pfad(sockel, 'none')
    s += kreis(64, 88, 15, PAPIER[0])
    for a in range(200, 521, 40):
        x, y = punkt(64, 88, a, 10)
        s += kreis(x, y, 2.1, ROT[1], 1)
    s += kreis(64, 88, 4.5, ROT[0], 1.4)
    s += pfad(hoerer, ROT[0])
    s += flaeche('M36 52 L92 52 L92 58 L36 58 Z', ROT[1])
    s += pfad(hoerer, 'none')
    s += glanz('M22 50 C24 46 30 45 34 47', 1.8)
    return s


def schluessel():
    s = Symbol()
    s.k(f'<path d="{bogen(42, 38, 17, 0, 359.9)}" stroke-width="13" fill="none"/>')
    s += linie(bogen(42, 38, 17, 0, 359.9), 5, STAHL[0])
    s += linie(bogen(42, 38, 17, 200, 260), 1.6, HELL)
    for winkel, cx, cy, f in ((38, 60, 58, MESSING), (95, 30, 62, STAHL)):
        g = f'<g transform="rotate({winkel} {cx} {cy})">'
        bart = P([(cx + 8, cy - 4), (cx + 56, cy - 4), (cx + 56, cy + 4), (cx + 50, cy + 4), (cx + 50, cy + 11), (cx + 44, cy + 11), (cx + 44, cy + 4), (cx + 38, cy + 4), (cx + 38, cy + 9), (cx + 32, cy + 9), (cx + 32, cy + 4), (cx + 8, cy + 4)])
        s.k(f'<path transform="rotate({winkel} {cx} {cy})" d="{bart}"/>', f'<path transform="rotate({winkel} {cx} {cy})" fill-rule="evenodd" d="{ring(cx, cy, 12, 5)}"/>')
        s += g + pfad(bart, f[0]) + flaeche(P([(cx + 8, cy + 0.5), (cx + 56, cy + 0.5), (cx + 56, cy + 4), (cx + 8, cy + 4)]), f[1])
        s += pfad(ring(cx, cy, 12, 5), f[0], 2, ' fill-rule="evenodd"')
        s += flaeche(f'M{cx} {cy + 12} A12 12 0 0 0 {cx + 12} {cy} L{cx + 5} {cy} A5 5 0 0 1 {cx} {cy + 5} Z', f[1]) + '</g>'
    return s


def versicherung():
    s = Symbol()
    dach = 'M14 66 Q20 26 64 22 Q108 26 114 66 Q103 58 92 66 Q78 58 64 66 Q50 58 36 66 Q25 58 14 66 Z'
    s.k(dach, '<path d="M64 66 L64 104 Q64 116 74 116 Q82 116 82 106" stroke-width="12" fill="none"/>', '<rect x="61" y="12" width="6" height="12" rx="2"/>')
    s += linie('M64 66 L64 104', 4, ANTHRAZIT[0]) + linie('M64 104 Q64 116 74 116 Q82 116 82 106', 6, HOLZ[0])
    s += rechteck(61, 12, 6, 12, ANTHRAZIT[0], 2, 1.6)
    seg = [('M14 66 Q20 26 64 22 Q40 34 36 66 Q25 58 14 66 Z', ORANGE[0]), ('M36 66 Q40 34 64 22 Q60 40 64 66 Q50 58 36 66 Z', PAPIER[0]),
           ('M64 66 Q60 40 64 22 Q88 34 92 66 Q78 58 64 66 Z', ORANGE[1]), ('M92 66 Q88 34 64 22 Q108 26 114 66 Q103 58 92 66 Z', PAPIER[1])]
    for d, f in seg:
        s += pfad(d, f, 1.8)
    s += pfad(dach, 'none')
    s += glanz('M22 54 Q28 36 46 30', 2)
    return s


def briefe():
    s = Symbol()
    g = '<g transform="rotate(-5 64 66)">'
    um = P([(14, 34), (114, 34), (114, 100), (14, 100)])
    s.k(f'<path transform="rotate(-5 64 66)" d="{um}"/>')
    s += g + pfad(um, PAPIER[0])
    s += flaeche(P([(14, 100), (60, 66), (68, 66), (114, 100)]), PAPIER[1])
    s += linie('M14 100 L58 66 M114 100 L70 66', 1.8)
    s += pfad(P([(14, 34), (64, 74), (114, 34)]), '#efe5cf', 2)
    s += pfad('M64 59 L69 61 L74 60 L75 65 L78 69 L75 73 L74 78 L69 77 L64 80 L59 77 L54 78 L53 73 L50 69 L53 65 L54 60 L59 61 Z', ROT[0], 1.8)
    s += kreis(64, 70, 6, ROT[1], 1.4) + linie('M61 70 L67 70', 1.4, PAPIER[0])
    s += glanz('M20 38 L56 66', 1.6) + '</g>'
    return s


def vorgaenge():
    s = Symbol()
    s.unten.append(boden(66, 110, 44, 6))
    body, sil, sp = quader(18, 58, 74, 46, 30, ROT)
    s.k(sil, '<path d="M40 52 L40 40 Q40 33 47 33 L71 33 Q78 33 78 40 L78 52" stroke-width="12" fill="none"/>')
    s += linie('M40 52 L40 40 Q40 33 47 33 L71 33 Q78 33 78 40 L78 52', 5, STAHL[0])
    s += body
    s += s.schraffur(P([sp(0, 0.5), sp(1, 0.5), sp(1, 1), sp(0, 1)]), 'M94 100 L100 94 M96 104 L106 92 M102 100 L110 92', 1.2, 0.65)
    s += linie('M18 72 L92 72', 2) + linie('M92 72 L113.6 59.4', 2)
    for x in (30, 70):
        s += rechteck(x, 66, 10, 10, STAHL[0], 2, 1.6)
    s += glanz('M21 60 L60 60', 1.6)
    return s


def kalender():
    s = Symbol()
    blatt = 'M26 24 L102 24 Q108 24 108 30 L108 106 Q108 112 102 112 L26 112 Q20 112 20 106 L20 30 Q20 24 26 24 Z'
    s.k(blatt, '<rect x="36" y="14" width="9" height="19" rx="3"/>', '<rect x="83" y="14" width="9" height="19" rx="3"/>')
    s += pfad(blatt, PAPIER[0])
    s += f'<g clip-path="{s.clip(blatt)}">' + flaeche(P([(20, 24), (108, 24), (108, 46), (20, 46)]), ROT[0]) + flaeche(P([(20, 24), (108, 24), (108, 30), (20, 30)]), heller(ROT[0], 0.2)) + flaeche(P([(70, 112), (108, 74), (108, 112)]), PAPIER[1]) + '</g>'
    s += linie('M20 46 L108 46', 2) + pfad(blatt, 'none')
    for x in (36, 83):
        s += rechteck(x, 14, 9, 19, STAHL[0], 3, 1.8)
    for i in range(3):
        for j in range(4):
            hell = (i, j) == (1, 2)
            s += rechteck(28 + j * 19, 54 + i * 17, 13, 11, ORANGE[0] if hell else '#e8dec8', 2, 1.6 if hell else 0)
    return s


def pruefung():
    s = Symbol()
    blatt = P([(18, 14), (68, 14), (82, 28), (82, 108), (18, 108)])
    s.k(blatt, '<path d="M95 88 L110 106" stroke-width="16" fill="none"/>', '<circle cx="76" cy="70" r="27"/>')
    s += pfad(blatt, PAPIER[0])
    s += pfad(P([(68, 14), (68, 28), (82, 28)]), PAPIER[1], 1.8)
    s += linie('M26 30 L54 30', 2.6) + linie('M26 42 L70 42 M26 51 L62 51 M26 92 L56 92 M26 100 L50 100', 1.5, None, 0.7)
    s += linie('M95 88 L110 106', 9, HOLZ[0])
    s += kreis(76, 70, 27, ANTHRAZIT[0])
    s += kreis(76, 70, 21, '#cdeaf6', 2)
    s += flaeche(sektor(76, 70, 20, 0, 120), HIMMEL[0], 0.45)
    s += glanz(bogen(76, 70, 16, 200, 260), 2.4)
    s += haken('M66 70 L73 77 L87 62', GRUEN[0], 4)
    return s


def status():
    s = Symbol()
    s.unten.append(boden(66, 112, 40, 6))
    body, sil, sp = quader(24, 28, 56, 84, 30, ANTHRAZIT, heller(ANTHRAZIT[0], 0.3))
    s.k(sil)
    s += body
    for i in range(6):
        a, b = sp(0.2, 0.15 + i * 0.12), sp(0.8, 0.15 + i * 0.12)
        s += linie(f'M{n(a[0])} {n(a[1])} L{n(b[0])} {n(b[1])}', 1.5, None, 0.7)
    for y in (36, 58):
        s += rechteck(30, y, 44, 17, ANTHRAZIT[1], 2, 1.8)
        s += linie(f'M36 {y + 8.5} L68 {y + 8.5}', 1.6, STAHL[1])
    for x, f in ((40, HIMMEL[0]), (52, '#5be08e'), (64, '#5be08e')):
        s += kreis(x, 92, 4.5, heller(f, 0.6), 0) + kreis(x, 92, 3, f, 1.4)
    s += glanz('M27 31 L50 31', 1.6) + glanz('M27 31 L27 70', 1.4)
    return s


def protokoll():
    s = Symbol()
    s.k('<circle cx="64" cy="66" r="40"/>')
    s += kreis(64, 66, 40, ORANGE[0])
    s += linie(bogen(64, 66, 36, 10, 160), 7, ORANGE[1])
    s += kreis(64, 66, 31, PAPIER[0])
    s += flaeche(sektor(64, 66, 30, 20, 150), PAPIER[1])
    for a in range(0, 360, 30):
        (x1, y1), (x2, y2) = punkt(64, 66, a, 25), punkt(64, 66, a, 28)
        s += linie(f'M{n(x1)} {n(y1)} L{n(x2)} {n(y2)}', 1.8 if a % 90 == 0 else 1.2)
    s += linie('M64 66 L64 46', 3.2) + linie('M64 66 L80 74', 3)
    s += kreis(64, 66, 3.5, ANTHRAZIT[0], 1.4)
    s += linie(bogen(64, 66, 52, 120, 300), 10, T) + linie(bogen(64, 66, 52, 120, 300), 5, PETROL[0])
    a = punkt(64, 66, 120, 52)
    spitze = P([(a[0] - 12, a[1] - 4), (a[0] + 6, a[1] - 10), (a[0] + 2, a[1] + 8)])
    s.k(spitze)
    s += pfad(spitze, PETROL[0], 1.8)
    return s


def export():
    s = Symbol()
    hinten = P([(14, 34), (46, 34), (54, 44), (110, 44), (110, 104), (14, 104)])
    vorn = P([(10, 56), (114, 56), (108, 108), (16, 108)])
    s.k(hinten, vorn)
    s += pfad(hinten, GELB[1])
    s += rechteck(28, 30, 54, 32, PAPIER[0], 1, 1.8)
    s += linie('M34 38 L70 38 M34 45 L62 45', 1.4, None, 0.7)
    s += pfad(vorn, GELB[0])
    s += flaeche(P([(70, 108), (114, 62), (114, 56), (108, 108)]), GELB[1])
    s += flaeche(P([(76, 108), (113, 64), (108, 108)]), GELB[1]) + pfad(vorn, 'none')
    s += glanz('M16 60 L60 60', 1.8)
    p = pfeil(54, 96, 104, 30, 5.5, 16, 13)
    s.k(p)
    s += pfad(p, GRUEN[0], 2)
    return s


def einstellungen():
    s = Symbol()
    def zahnrad(cx, cy):
        pkt = []
        for i in range(8):
            b = i * 45
            pkt += [punkt(cx, cy, b - 16, 33), punkt(cx, cy, b - 9, 44), punkt(cx, cy, b + 9, 44), punkt(cx, cy, b + 16, 33)]
        return P(pkt)
    hinten, vorn = zahnrad(68, 70), zahnrad(62, 62)
    s.k(hinten, vorn)
    s += pfad(hinten, STAHL[1])
    s += pfad(vorn, STAHL[0])
    s += f'<g clip-path="{s.clip(vorn)}">' + flaeche('M20 110 L110 20 L120 120 Z', dunkler(STAHL[0], 0.12)) + '</g>' + pfad(vorn, 'none')
    s += kreis(62, 62, 22, heller(STAHL[0], 0.25), 1.8)
    s += kreis(62, 62, 11, ANTHRAZIT[1])
    s += glanz(bogen(62, 62, 18, 200, 260), 2)
    return s


def glocke():
    s = Symbol()
    k = 'M64 18 C80 18 88 30 88 48 C88 66 92 78 104 88 L24 88 C36 78 40 66 40 48 C40 30 48 18 64 18 Z'
    s.k('<circle cx="64" cy="104" r="9"/>', k, '<rect x="18" y="85" width="92" height="12" rx="6"/>', '<circle cx="64" cy="15" r="6"/>')
    s += kreis(64, 104, 9, MESSING[1])
    s += pfad(k, MESSING[0])
    s += f'<g clip-path="{s.clip(k)}">' + flaeche('M68 14 C86 20 90 40 90 56 C90 70 96 80 108 90 L70 90 Z', MESSING[1]) + '</g>' + pfad(k, 'none')
    s += rechteck(18, 85, 92, 12, MESSING[1], 6)
    s += kreis(64, 15, 6, MESSING[0], 1.8)
    s += glanz('M48 70 C48 56 47 36 56 28', 2.4)
    return s


def kamera():
    s = Symbol()
    s.k('<rect x="40" y="28" width="34" height="16" rx="4"/>', '<rect x="86" y="31" width="16" height="10" rx="3"/>', '<rect x="12" y="38" width="104" height="68" rx="10"/>')
    s += rechteck(40, 28, 34, 16, ANTHRAZIT[0], 4) + rechteck(86, 31, 16, 10, ORANGE[0], 3)
    s += rechteck(12, 38, 104, 68, ANTHRAZIT[0], 10)
    s += flaeche('M88 40 L106 40 Q114 40 114 48 L114 96 Q114 104 106 104 L72 104 Z', ANTHRAZIT[1])
    s += rechteck(12, 38, 104, 68, 'none', 10)
    s += rechteck(20, 46, 13, 8, PAPIER[0], 2, 1.6)
    s += linie('M18 64 L18 96 M23 64 L23 96', 1.4, STAHL[1])
    s += kreis(66, 72, 26, STAHL[0]) + kreis(66, 72, 19, GLAS)
    s += flaeche(sektor(66, 72, 18, 20, 160), T, 0.35)
    s += linie(bogen(66, 72, 14, 200, 255), 3, GLAS_LICHT) + kreis(73, 64, 2.2, '#ffffff', 0)
    s += glanz('M18 44 L44 44', 1.6)
    return s


def mehr():
    s = Symbol()
    kacheln = ((18, 18, ORANGE), (66, 18, PETROL), (18, 66, GELB), (66, 66, HIMMEL))
    s.k(*[f'<rect x="{x}" y="{y}" width="42" height="42" rx="9"/>' for x, y, _ in kacheln])
    for x, y, f in kacheln:
        s += rechteck(x, y + 5, 42, 37, f[1], 9)
        s += rechteck(x, y, 42, 36, f[0], 9)
        s += glanz(f'M{x + 7} {y + 7} L{x + 22} {y + 7}', 1.8)
    return s


def miete():
    s = Symbol()
    g = '<g transform="rotate(38 46 44)">'
    bart = P([(56, 40), (110, 40), (110, 48), (104, 48), (104, 56), (98, 56), (98, 48), (91, 48), (91, 54), (85, 54), (85, 48), (56, 48)])
    s.k(f'<path transform="rotate(38 46 44)" d="{bart}"/>', f'<path transform="rotate(38 46 44)" fill-rule="evenodd" d="{ring(46, 44, 18, 7)}"/>', P([(12, 74), (34, 66), (42, 96), (20, 104)]))
    s += linie('M30 58 L24 70', 2)
    s += pfad(P([(12, 74), (34, 66), (42, 96), (20, 104)]), ORANGE[0])
    s += flaeche(P([(27, 99), (38, 83), (42, 96), (20, 104)]), ORANGE[1]) + pfad(P([(12, 74), (34, 66), (42, 96), (20, 104)]), 'none')
    s += kreis(23, 75, 2.5, '#ffffff', 1.3)
    s += g + pfad(bart, MESSING[0]) + flaeche(P([(56, 44.5), (110, 44.5), (110, 48), (56, 48)]), MESSING[1])
    s += pfad(ring(46, 44, 18, 7), MESSING[0], 2, ' fill-rule="evenodd"')
    s += flaeche(f'M46 62 A18 18 0 0 0 64 44 L53 44 A7 7 0 0 1 46 51 Z', MESSING[1])
    s += glanz(bogen(46, 44, 13, 200, 260), 2) + '</g>'
    return s


def projekte():
    s = Symbol()
    s.k('<rect x="20" y="70" width="88" height="24" rx="4"/>', '<ellipse cx="108" cy="82" rx="6" ry="12"/>')
    s += rechteck(20, 70, 88, 24, HIMMEL[0], 4)
    s += flaeche(P([(20, 84), (108, 84), (108, 94), (20, 94)]), HIMMEL[1])
    s += linie('M30 74 L30 90 M44 74 L44 90 M88 74 L88 90 M20 79 L108 79', 1, '#e8f6ff', 0.8)
    s += ellipse(108, 82, 6, 12, heller(HIMMEL[0], 0.3)) + ellipse(108, 82, 2, 4, HIMMEL[1], 1.2)
    helm = 'M28 76 C28 46 46 30 64 30 C82 30 100 46 100 76 Z'
    krempe = 'M16 78 Q16 72 22 72 L106 72 Q112 72 112 78 Q112 84 106 84 L22 84 Q16 84 16 78 Z'
    s.k(helm, krempe)
    s += pfad(helm, GELB[0])
    s += f'<g clip-path="{s.clip(helm)}">' + flaeche('M70 26 L104 26 L104 80 L82 80 C84 60 80 40 70 26 Z', GELB[1]) + '</g>' + pfad(helm, 'none')
    s += pfad('M57 31 Q64 28 71 31 L71 74 L57 74 Z', heller(GELB[0], 0.3), 1.8)
    s += pfad(krempe, GELB[1])
    s += glanz('M38 64 C38 52 44 42 52 37', 2.2)
    return s


def zeitplan():
    s = Symbol()
    tafel = 'M20 22 L108 22 Q114 22 114 28 L114 100 Q114 106 108 106 L20 106 Q14 106 14 100 L14 28 Q14 22 20 22 Z'
    s.k(tafel)
    s += pfad(tafel, PAPIER[0])
    s += f'<g clip-path="{s.clip(tafel)}">' + flaeche(P([(14, 22), (114, 22), (114, 36), (14, 36)]), STAHL[0]) + flaeche(P([(76, 106), (114, 68), (114, 106)]), PAPIER[1]) + '</g>'
    s += linie('M14 36 L114 36', 2) + pfad(tafel, 'none')
    s += linie('M40 36 L40 104 M64 36 L64 104 M88 36 L88 104', 1, None, 0.25)
    for x, y, w, f in ((22, 44, 42, ORANGE), (42, 62, 50, PETROL), (66, 80, 40, GELB)):
        s += rechteck(x, y, w, 11, f[0], 3, 1.8)
        s += flaeche(P([(x + 2, y + 7), (x + w - 2, y + 7), (x + w - 2, y + 9.5), (x + 2, y + 9.5)]), f[1])
    s += linie('M80 40 L80 102', 2.4, ROT[0])
    s += pfad(P([(75, 38), (85, 38), (80, 45)]), ROT[0], 1.4)
    return s


def kosten():
    s = Symbol()
    s.k('<rect transform="rotate(-10 60 44)" x="26" y="28" width="66" height="32" rx="2"/>', '<rect x="16" y="46" width="94" height="62" rx="9"/>', 'M62 60 L110 60 L110 84 L62 84 Z')
    s += '<g transform="rotate(-10 60 44)">' + rechteck(26, 28, 66, 32, GRUEN[0], 2) + kreis(59, 44, 8, GRUEN[1], 1.6) + linie('M32 34 L44 34', 1.4, '#e7f7ea') + '</g>'
    s += rechteck(16, 46, 94, 62, LEDER[0], 9)
    s += flaeche('M80 48 L102 48 Q108 48 108 54 L108 100 Q108 106 102 106 L60 106 Z', LEDER[1])
    s += rechteck(16, 46, 94, 62, 'none', 9)
    s += f'<rect x="22" y="52" width="82" height="50" rx="6" fill="none" stroke="{PAPIER[0]}" stroke-width="1.3" stroke-dasharray="3 3" stroke-opacity=".7"/>'
    s += pfad('M62 60 L110 60 L110 84 L62 84 Q56 84 56 78 L56 66 Q56 60 62 60 Z', dunkler(LEDER[0], 0.12))
    s += kreis(70, 72, 4.5, MESSING[0], 1.6)
    s += glanz('M22 52 L50 52', 1.6)
    return s


def fotos():
    s = Symbol()
    g = '<g transform="rotate(-5 64 64)">'
    s.k('<rect transform="rotate(-5 64 64)" x="16" y="14" width="96" height="100" rx="3"/>')
    s += g + rechteck(16, 14, 96, 100, PAPIER[0], 3)
    s += flaeche(P([(64, 114), (112, 66), (112, 114)]), PAPIER[1])
    s += rechteck(16, 14, 96, 100, 'none', 3)
    s += rechteck(24, 22, 80, 66, HIMMEL[0], 1, 1.8)
    s += kreis(86, 38, 8, GELB[0], 1.6)
    s += pfad(P([(24, 88), (48, 50), (62, 70), (76, 54), (104, 88)]), STAHL[1], 1.8)
    s += pfad(P([(43, 58), (48, 50), (53, 58), (48, 61)]), PAPIER[0], 1.4)
    s += pfad('M24 88 Q50 70 104 84 L104 88 Z', GRUEN[0], 1.8)
    s += linie('M30 100 L66 100', 2, None, 0.6) + '</g>'
    return s


def suche():
    s = Symbol()
    s.k('<path d="M80 80 L106 106" stroke-width="18" fill="none"/>', '<circle cx="54" cy="54" r="34"/>')
    s += linie('M80 80 L106 106', 11, HOLZ[0]) + linie('M88 92 L104 108', 4, HOLZ[1])
    s += kreis(54, 54, 34, ANTHRAZIT[0])
    s += kreis(54, 54, 26, '#cdeaf6', 2)
    s += flaeche(sektor(54, 54, 25, 0, 120), HIMMEL[0], 0.45)
    s += glanz(bogen(54, 54, 19, 200, 265), 3)
    return s


SYMBOLE = {
    'cockpit': ('Cockpit', cockpit), 'aufgaben': ('Aufgaben', aufgaben), 'objekte': ('Objekte', objekte), 'steckbrief': ('Steckbrief', steckbrief),
    'einheiten': ('Einheiten / WEG', einheiten), 'mieter': ('Mieter / Eigentümer', mieter), 'zaehler': ('Zähler', zaehler), 'umlage': ('Umlageschlüssel', umlage),
    'adressbuch': ('Adressbuch', adressbuch), 'postfach': ('Postfach', postfach), 'vorschlaege': ('Vorschläge von Claude', vorschlaege), 'archiv': ('Archiv & Suche', archiv),
    'rechnungen': ('Rechnungen', rechnungen), 'buchungen': ('Buchungen', buchungen), 'konten': ('Konten', konten), 'sollstellung': ('Sollstellung', sollstellung),
    'op': ('Offene Posten', offene_posten), 'bank': ('Bank & SEPA', bank), 'darlehen': ('Darlehen', darlehen), 'betriebskosten': ('Betriebskosten', betriebskosten),
    'jahresabrechnung': ('Jahresabrechnung', jahresabrechnung), 'wirtschaftsplan': ('Wirtschaftsplan', wirtschaftsplan), 'ruecklagen': ('Rücklagen', ruecklagen),
    'rendite': ('Rendite & Steuer', rendite), 'kaution': ('Kautionen', kaution), 'anpassung': ('Mietanpassungen', anpassung), 'vermietung': ('Vermietung', vermietung),
    'uebergabe': ('Übergaben', uebergabe), 'versammlung': ('Versammlungen', versammlung), 'beschluesse': ('Beschluss-Sammlung', beschluesse),
    'kontakte': ('Ansprechpartner', kontakte), 'schluessel': ('Schlüssel', schluessel), 'versicherung': ('Versicherungen', versicherung), 'briefe': ('Briefe', briefe),
    'vorgaenge': ('Vorgänge', vorgaenge), 'kalender': ('Kalender', kalender), 'pruefung': ('Prüfbericht', pruefung), 'status': ('Status', status),
    'protokoll': ('Änderungsprotokoll', protokoll), 'export': ('Export & Steuer', export), 'einstellungen': ('Einstellungen', einstellungen),
    'glocke': ('Mitteilungen', glocke), 'kamera': ('Foto', kamera), 'mehr': ('Mehr', mehr), 'miete': ('Miete (Modus)', miete), 'projekte': ('Projekte', projekte),
    'zeitplan': ('Zeitplan', zeitplan), 'kosten': ('Kosten & Budget', kosten), 'fotos': ('Fotos & Dokumente', fotos), 'suche': ('Suche', suche),
}

if __name__ == '__main__':
    ziel = sys.argv[1]
    os.makedirs(ziel, exist_ok=True)
    for i, (name, (titel, fn)) in enumerate(SYMBOLE.items()):
        with open(os.path.join(ziel, f'{name}.svg'), 'w') as f:
            f.write(fn().svg(seed=3 + i))
    print(len(SYMBOLE), 'Symbole')
