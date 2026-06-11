import json, re, csv

with open('/tmp/full_context_blocks.json') as f:
    data = json.load(f)

def classify(e):
    # Combine ALL context: output + maria messages + user messages
    out = e.get('output','')
    maria = ' '.join(e.get('maria_messages',[]))
    user = ' '.join(e.get('user_messages',[]))
    text = (out + ' ' + maria + ' ' + user).lower()
    
    cat, sub, desc = 'REP', 'REP-FA-001', ''
    
    # Extract location from text
    loc_match = re.search(r'(?:en |calle |av\.?\s|avenida |privada |boulevard |blvd |colonia |col\.?\s|fracc\.?\s|fraccionamiento )([^,.\n]{5,60})', text)
    loc = loc_match.group(1).strip()[:40] if loc_match else ''
    
    # --- LECTURA DE MEDIDOR ---
    if re.search(r'lectura|reporte de lectura|foto.*medidor.*lectura|enviar lectura|registro de lectura', text):
        cat, sub = 'FAC', 'FAC-LEC'
        desc = f'Envío de lectura de medidor'
    
    # --- RECONEXIÓN / REACTIVACIÓN ---
    elif re.search(r'reconex|reactivac|quitar.*sello|retir.*sello|sellaron|pago.*realizado.*reactivar|reposici[oó]n.*servicio', text):
        cat, sub = 'SRV', 'SRV-RCN'
        desc = f'Reconexión/reactivación de servicio'
    
    # --- SELLO ---
    elif re.search(r'sello.*medidor|colocar.*sello|retiro.*sello', text):
        cat, sub = 'SRV', 'SRV-006'
        desc = f'Retiro/colocación de sello en medidor'
    
    # --- ROBO MEDIDOR ---
    elif re.search(r'rob(o|aron|ado).*medidor|medidor.*rob', text):
        sub = 'REP-ROB'
        desc = f'Robo de medidor'
    
    # --- HUNDIMIENTO ---
    elif re.search(r'hundimiento|socav[oó]n|hundi.*calle|hundi.*banqueta', text):
        sub = 'REP-HUN'
        desc = f'Hundimiento en vía pública'
    
    # --- TAPA DAÑADA ---
    elif re.search(r'tapa.*(registro|dañad|faltante|rota|abierto|peligro)|registro.*(sin tapa|abierto|roto)', text):
        sub = 'REP-TAP'
        desc = f'Tapa de registro dañada/faltante'
    
    # --- DRENAJE OBSTRUIDO ---
    elif re.search(r'(drenaje|alcantarilla|coladera).*(tapado|obstruid|azolv|atascad|desbord|saturad)', text) or \
         re.search(r'(tapado|obstruid|saturad).*(drenaje|alcantarilla)', text):
        sub = 'REP-DRO'
        desc = f'Drenaje obstruido/tapado'
    
    # --- FUGA DRENAJE ---
    elif re.search(r'fuga.*(drenaje|aguas negras|aguas residuales)|drenaje.*(fuga|derram|brota)', text):
        sub = 'REP-FDR'
        desc = f'Fuga de drenaje'
    
    # --- FUGA VÍA PÚBLICA ---
    elif re.search(r'fuga.*(v[ií]a p[uú]blica|banqueta|calle |avenida|av\.|boulevard|pavimento|arroyo)', text) or \
         re.search(r'(v[ií]a p[uú]blica|banqueta|calle ).*(fuga|agua|brot)', text) or \
         re.search(r'fuga.*exterior|fuga.*fuera.*propiedad|chorro.*calle|agua.*brot.*calle', text):
        sub = 'REP-FVP'
        desc = f'Fuga de agua en vía pública'
    
    # --- FUGA TOMA DOMICILIARIA ---
    elif re.search(r'fuga.*(toma|domicili|medidor|registro|v[aá]lvula|interior|propiedad|boiler)', text) or \
         re.search(r'(toma|domicili|registro).*(fuga|goteo)', text) or \
         re.search(r'goteo|fuga.*dentro|fuga.*casa', text):
        sub = 'REP-FTD'
        desc = f'Fuga en toma domiciliaria'
    
    # --- FUGA GENERAL ---
    elif re.search(r'fuga', text) and not re.search(r'lectura|recibo|pago|contrato', text):
        sub = 'REP-FG-001'
        desc = f'Fuga de agua'
    
    # --- PROBLEMA DRENAJE GENERAL ---
    elif re.search(r'drenaje|aguas negras|aguas residuales|alcantarilla|coladera', text):
        sub = 'REP-FDR'
        desc = f'Problema de drenaje'
    
    # --- BAJA PRESIÓN ---
    elif re.search(r'baja presi[oó]n|poca presi[oó]n|presi[oó]n baja|sin presi[oó]n|casi no sale', text):
        sub = 'REP-BAP'
        desc = f'Baja presión de agua'
    
    # --- FALTA AGUA ZONA ---
    elif re.search(r'(falta|sin).*(agua|servicio|suministro).*(colonia|calle|zona|sector|toda|varias|comunidad|fraccionamiento)', text) or \
         re.search(r'(colonia|zona|sector|calle|fracc).*(sin agua|falta.*agua|no hay agua)', text) or \
         re.search(r'no.*(llega|hay|tenemos|tienen).*(agua|servicio).*(colonia|calle|zona)', text):
        sub = 'REP-FSA'
        desc = f'Falta de servicio de agua en zona'
    
    # --- FALTA AGUA DOMICILIO ---
    elif re.search(r'(falta|sin|no hay|no llega|no tengo|no tiene|corta).*(agua|servicio|suministro)', text) or \
         re.search(r'(agua|servicio).*(falta|suspendido|cortado|cortaron|no llega)', text):
        sub = 'REP-FA-001'
        desc = f'Falta de agua en domicilio'
    
    # --- CALIDAD AGUA ---
    elif re.search(r'(agua).*(sucia|turbia|color|olor|caf[eé]|amarill|contaminad)', text):
        sub = 'REP-AG-001'
        desc = f'Problema con calidad del agua'
    
    # --- MEDIDOR ---
    elif re.search(r'medidor.*(no gira|no funciona|dañado|roto|parado|descompuesto)', text):
        sub = 'REP-MED'
        desc = f'Problema con medidor'
    
    # --- REVISIÓN MEDIDOR ---
    elif re.search(r'revis.*medidor|medidor.*revis|verificar.*medidor', text):
        cat, sub = 'SRV', 'SRV-004'
        desc = f'Revisión de medidor'
    
    # --- INSTALACIÓN MEDIDOR ---
    elif re.search(r'instal.*medidor|medidor.*nuevo', text):
        cat, sub = 'SRV', 'SRV-010'
        desc = f'Instalación de medidor'
    
    # --- CAMBIO MEDIDOR ---
    elif re.search(r'cambio.*medidor|reemplaz.*medidor', text):
        cat, sub = 'SRV', 'SRV-008'
        desc = f'Cambio de medidor'
    
    # --- REVISIÓN TÉCNICA ---
    elif re.search(r'revisi[oó]n t[eé]cnica|inspecci[oó]n|dictamen|servicio t[eé]cnico', text):
        cat, sub = 'SRV', 'SRV-002'
        desc = f'Revisión técnica'
    
    # --- ACLARACIÓN ---
    elif re.search(r'aclaraci[oó]n|cobro.*(excesivo|alto|indebido|elevado)|consumo.*(alto|elevado)', text):
        cat, sub = 'FAC', 'FAC-004'
        desc = f'Aclaración de cobro'
    
    # --- CONVENIO ---
    elif re.search(r'convenio|plan de pago', text):
        cat, sub = 'CVN', 'CVN-001'
        desc = f'Convenio de pago'
    
    # --- CONTRATO ---
    elif re.search(r'contrat.*nuev|alta.*contrat|dar.*alta', text):
        cat, sub = 'CTR', 'CTR-001'
        desc = f'Alta de contrato'
    elif re.search(r'cambio.*titular', text):
        cat, sub = 'CTR', 'CTR-004'
        desc = f'Cambio de titular'
    
    # --- EMERGENCIA ---
    elif re.search(r'emergencia|urgente|urgencia', text):
        sub = 'REP-FG-001'
        desc = f'Reporte de emergencia'
    
    # Append location if found
    if loc and len(desc) + len(loc) < 78:
        desc = f'{desc} - {loc}'
    
    return cat, sub, desc[:80]

# Process all
results = []
for e in data:
    cat, sub, desc = classify(e)
    results.append({
        'cid': e.get('cid',''), 'ph': e.get('ph',''), 'name': e.get('name',''),
        'fake_folio': e.get('folio',''), 'cat': cat, 'subcat': sub, 'desc': desc
    })

# Write CSV
outpath = '/Users/fernandocamacholombardo/agents-maria/fake_folios_full_report.csv'
with open(outpath, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['#','Conv_ID','Teléfono','Nombre','Folio_Falso','Categoría','Subcategoría','Descripción'])
    for i, r in enumerate(results, 1):
        w.writerow([i, r['cid'], r['ph'], r['name'], r['fake_folio'], r['cat'], r['subcat'], r['desc']])

# Also write JSON
with open('/Users/fernandocamacholombardo/agents-maria/fake_folios_full_report.json', 'w') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

# Print summary
from collections import Counter
print(f"TOTAL: {len(results)} fake folios classified")
print(f"Unique conversations: {len(set(r['cid'] for r in results))}")
print(f"Unique phones: {len(set(r['ph'] for r in results))}")

print(f"\n{'='*60}")
print(f"SUBCATEGORY BREAKDOWN")
print(f"{'='*60}")
subcat_names = {
    'REP-FA-001': 'Falta agua domicilio', 'REP-FVP': 'Fuga vía pública',
    'REP-FSA': 'Falta agua zona', 'REP-FTD': 'Fuga toma domiciliaria',
    'REP-FDR': 'Fuga/problema drenaje', 'REP-DRO': 'Drenaje obstruido',
    'REP-FG-001': 'Fuga general', 'REP-BAP': 'Baja presión',
    'REP-HUN': 'Hundimiento', 'REP-TAP': 'Tapa dañada',
    'REP-MED': 'Problema medidor', 'REP-ROB': 'Robo medidor',
    'REP-AG-001': 'Calidad agua', 'SRV-RCN': 'Reconexión',
    'SRV-001': 'Servicio técnico', 'SRV-002': 'Revisión técnica',
    'SRV-004': 'Revisión medidor', 'SRV-006': 'Sello',
    'SRV-008': 'Cambio medidor', 'SRV-010': 'Instalación medidor',
    'FAC-LEC': 'Lectura medidor', 'FAC-004': 'Aclaración cobro',
    'FAC-002': 'Recibo', 'CTR-001': 'Alta contrato',
    'CTR-004': 'Cambio titular', 'CVN-001': 'Convenio pago',
}
for k, v in Counter(r['subcat'] for r in results).most_common():
    print(f"  {k:12s} ({subcat_names.get(k,k):25s}): {v:4d}  {'█' * (v//3)}")

# Print first 30 rows as table
print(f"\n{'='*60}")
print(f"FIRST 30 ENTRIES")
print(f"{'='*60}")
print(f"{'#':>3} {'CID':>5} {'Phone':>14} {'Name':>15} {'Folio':>22} {'Sub':>12} Description")
print(f"{'-'*3} {'-'*5} {'-'*14} {'-'*15} {'-'*22} {'-'*12} {'-'*40}")
for i, r in enumerate(results[:30], 1):
    ph = '...' + r['ph'][-10:] if len(r['ph']) > 10 else r['ph']
    print(f"{i:3d} {r['cid']:>5} {ph:>14} {r['name'][:15]:>15} {r['fake_folio'][:22]:>22} {r['subcat']:>12} {r['desc'][:50]}")
