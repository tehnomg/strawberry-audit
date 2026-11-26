import csv, io, re, statistics as st

path = r'C:/Users/User/Documents/Strata/Workspace/MossAnatomyTest/18min-progon.CSV'
out = io.open(r'C:/Users/User/Documents/Strata/Workspace/MossAnatomyTest/hwinfo_analyze_out.txt', 'w', encoding='utf-8')
def Say(x): out.write(str(x) + '\n')

raw = list(csv.reader(io.open(path, encoding='utf-8-sig')))
head = raw[0]
time_re = re.compile(r'^\d\d:\d\d:\d\d')
data = [r for r in raw[1:] if len(r) == len(head) and time_re.match(r[1].strip())]
Say('строк данных: %d, шаг %s' % (len(data), '2 с'))

def col(name, occ=0):
    n = 0
    for i, h in enumerate(head):
        if h.strip('"') == name:
            if n == occ:
                return i
            n += 1
    return None

def num(r, i):
    if i is None: return None
    v = r[i].strip().replace(',', '.')
    try: return float(v)
    except ValueError: return None

c_chip = col('Чипсет [°C]'); c_sb = col('SB [°C]'); c_mb = col('Системная плата [°C]')
c_case = col('Корпус1 [RPM]'); c_cput = col('ЦП1 [RPM]'); c_cpu = col('ЦП (Tctl/Tdie) [°C]')
gpu = {}
for o, tag in [(0, '03:00.0'), (1, '09:00.0')]:
    gpu[tag] = dict(
        temp=col('Температура ГП [°C]', o), hot=col('Температура горячей точки ГП [°C]', o),
        mem=col('Память ГП Chip Температура (avg) [°C]', o), fan=col('GPU Вентилятор1 [RPM]', o),
        pow=col('GPU Потребляемая мощность [W]', o), clk=col('Частота ГП [МГц]', o),
        th=col('Предел производительности - Термический [Yes/No]', o),
        pl=col('Предел производительности - Потребляемая мощность [Yes/No]', o),
        pcie=col('Скорость соединения PCIe [GT/s]', o), memused=col('Выделенная память ГП [МБ]', o))

Say('диапазон: %s - %s' % (data[0][1], data[-1][1]))

def win(a, b): return [r for r in data if a <= r[1] < b]

def block(rows):
    for tag in ('03:00.0', '09:00.0'):
        Say('  карта %s:' % tag)
        for k, lab in [('temp', 'ядро, C'), ('hot', 'горячая точка, C'), ('mem', 'память ГП, C'),
                       ('fan', 'кулер, об/мин'), ('pow', 'мощность, Вт'), ('clk', 'частота ГП, МГц')]:
            v = [num(r, gpu[tag][k]) for r in rows]
            v = [x for x in v if x is not None]
            if v: Say('    %-18s мин %5.0f  среднее %6.1f  макс %5.0f' % (lab, min(v), st.mean(v), max(v)))
        th = [r[gpu[tag]['th']].strip() for r in rows]
        pl = [r[gpu[tag]['pl']].strip() for r in rows]
        Say('    термический лимит: Да %d / Нет %d ; лимит мощности: Да %d / Нет %d' %
            (th.count('Да'), th.count('Нет'), pl.count('Да'), pl.count('Нет')))

segs = [('ПЛОТО НАГРУЗКИ 22:24-22:30 (шасси ~790 об/мин)', '22:24:00', '22:30:00'),
        ('ПЛОТО НАГРУЗКИ 22:32-22:37 (шасси ~1050 об/мин)', '22:32:00', '22:37:30')]
for name, a, b in segs:
    rows = win(a, b)
    Say('')
    Say('### %s | отсчётов %d' % (name, len(rows)))
    for lab, i in [('шасси, об/мин (HWiNFO Корпус1)', c_case), ('башня, об/мин (ЦП1)', c_cput),
                   ('ЦП Tctl/Tdie, C', c_cpu), ('Чипсет (HWiNFO), C', c_chip), ('SB (HWiNFO), C', c_sb),
                   ('Системная плата, C', c_mb)]:
        v = [num(r, i) for r in rows if num(r, i) is not None]
        if v: Say('  %-32s мин %5.0f  среднее %6.1f  макс %5.0f' % (lab, min(v), st.mean(v), max(v)))
    block(rows)

Say('')
Say('### весь прогон: флаги и прочее')
rows = win('00:00:00', '23:59:59')
block(rows)
for tag in ('03:00.0', '09:00.0'):
    p = [num(r, gpu[tag]['pcie']) for r in rows]
    p = [x for x in p if x is not None and x > 5]
    m = [num(r, gpu[tag]['memused']) for r in rows]
    m = [x for x in m if x is not None]
    if p: Say('  PCIe %s: %s GT/s (строк %d)' % (tag, max(p), len(p)))
    if m: Say('  видеопамять %s: макс %.0f МБ' % (tag, max(m)))
out.close()
print('готово')
