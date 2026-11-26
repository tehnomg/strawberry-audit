import csv, io, re, statistics as st

path = r'C:/Users/User/Documents/Strata/Workspace/MossAnatomyTest/18min-progon.CSV'
outp = r'C:/Users/User/Documents/Strata/Workspace/MossAnatomyTest/hwinfo_ab.txt'
raw = list(csv.reader(io.open(path, encoding='utf-8-sig')))
head = raw[0]
data = [r for r in raw[1:] if len(r) == len(head) and re.match(r'^\d\d:\d\d:\d\d', r[1].strip())]

def col(name, occ=0):
    n = 0
    for i, h in enumerate(head):
        if h.strip('"') == name:
            if n == occ:
                return i
            n += 1
    return None

def num(r, i):
    try:
        return float(r[i].strip().replace(',', '.'))
    except Exception:
        return None

g = [dict(temp=col('Температура ГП [°C]', o), hot=col('Температура горячей точки ГП [°C]', o),
          mem=col('Память ГП Chip Температура (avg) [°C]', o), fan=col('GPU Вентилятор1 [RPM]', o),
          pw=col('GPU Потребляемая мощность [W]', o), clk=col('Частота ГП [МГц]', o)) for o in (0, 1)]
case = col('Corpus') or col('Корпус1 [RPM]')

out = io.open(outp, 'w', encoding='utf-8')
for name, a, b in [('A  22:24-22:30', '22:24:00', '22:30:00'), ('B  22:32-22:37', '22:32:00', '22:37:30')]:
    rows = [r for r in data if a <= r[1] < b]
    for idx, tag in enumerate(('03:00.0 (верх)', '09:00.0 (низ)')):
        sel = [r for r in rows if (num(r, g[idx]['pw']) or 0) >= 170]
        if not sel:
            continue
        cs = [num(r, case) for r in sel]
        cs = [x for x in cs if x is not None]
        out.write('%s | карта %s | отсчётов с мощностью >= 170 Вт: %d | шасси по HWiNFO %.0f об/мин\n'
                  % (name, tag, len(sel), st.mean(cs)))
        for k, lab in [('temp', 'ядро, C'), ('hot', 'горячая точка, C'), ('mem', 'память ГП, C'),
                       ('fan', 'кулер, об/мин'), ('pw', 'мощность, Вт'), ('clk', 'частота ГП, МГц')]:
            v = [num(r, g[idx][k]) for r in sel]
            v = [x for x in v if x is not None]
            out.write('    %-18s среднее %6.1f  макс %5.0f\n' % (lab, st.mean(v), max(v)))
        out.write('\n')
out.close()
print('ok')
