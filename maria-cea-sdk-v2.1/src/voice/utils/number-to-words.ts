/**
 * Spanish number-to-words converter for voice output
 */

const UNITS = [
  '', 'uno', 'dos', 'tres', 'cuatro', 'cinco',
  'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
  'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'
];

const TENS = [
  '', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta',
  'sesenta', 'setenta', 'ochenta', 'noventa'
];

const HUNDREDS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos'
];

function convertHundreds(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  if (n < 30) return UNITS[n];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const units = n % 10;
    if (units === 0) return TENS[tens];
    return `${TENS[tens]} y ${UNITS[units]}`;
  }
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  if (remainder === 0) return HUNDREDS[hundreds] === 'ciento' ? 'cien' : HUNDREDS[hundreds];
  return `${HUNDREDS[hundreds]} ${convertHundreds(remainder)}`;
}

function convertThousands(n: number): string {
  if (n === 0) return '';
  if (n < 1000) return convertHundreds(n);
  if (n === 1000) return 'mil';
  if (n < 2000) return `mil ${convertHundreds(n % 1000)}`;
  const thousands = Math.floor(n / 1000);
  const remainder = n % 1000;
  const thousandsWord = convertHundreds(thousands);
  if (remainder === 0) return `${thousandsWord} mil`;
  return `${thousandsWord} mil ${convertHundreds(remainder)}`;
}

function convertMillions(n: number): string {
  if (n === 0) return 'cero';
  if (n < 1000000) return convertThousands(n);
  if (n === 1000000) return 'un millón';
  if (n < 2000000) {
    const remainder = n % 1000000;
    if (remainder === 0) return 'un millón';
    return `un millón ${convertThousands(remainder)}`;
  }
  const millions = Math.floor(n / 1000000);
  const remainder = n % 1000000;
  const millionsWord = convertThousands(millions);
  if (remainder === 0) return `${millionsWord} millones`;
  return `${millionsWord} millones ${convertThousands(remainder)}`;
}

/**
 * Convert a number to Spanish words
 */
export function numberToSpanishWords(n: number): string {
  if (n < 0) return `menos ${numberToSpanishWords(Math.abs(n))}`;
  if (!Number.isFinite(n)) return 'número inválido';
  const intPart = Math.floor(n);
  return convertMillions(intPart);
}

/**
 * Format currency amount for voice output
 * Example: 1523.45 -> "mil quinientos veintitrés pesos con cuarenta y cinco centavos"
 */
export function formatCurrencyForVoice(amount: number): string {
  if (!Number.isFinite(amount)) return 'cantidad inválida';

  const absAmount = Math.abs(amount);
  const pesos = Math.floor(absAmount);
  const centavos = Math.round((absAmount - pesos) * 100);

  let result = '';

  // Handle negative
  if (amount < 0) result = 'menos ';

  // Handle zero
  if (pesos === 0 && centavos === 0) return 'cero pesos';

  // Pesos part
  if (pesos > 0) {
    const pesosWord = pesos === 1 ? 'un peso' : `${numberToSpanishWords(pesos)} pesos`;
    result += pesosWord;
  }

  // Centavos part
  if (centavos > 0) {
    if (pesos > 0) result += ' con ';
    const centavosWord = centavos === 1
      ? 'un centavo'
      : `${numberToSpanishWords(centavos)} centavos`;
    result += centavosWord;
  }

  return result;
}

/**
 * Spell out digits individually for contract numbers, folios, etc.
 * Example: "523160" -> "cinco, dos, tres, uno, seis, cero"
 */
export function spellDigits(digits: string): string {
  const digitWords: Record<string, string> = {
    '0': 'cero',
    '1': 'uno',
    '2': 'dos',
    '3': 'tres',
    '4': 'cuatro',
    '5': 'cinco',
    '6': 'seis',
    '7': 'siete',
    '8': 'ocho',
    '9': 'nueve'
  };

  return digits
    .split('')
    .filter(char => /[0-9]/.test(char))
    .map(digit => digitWords[digit])
    .join(', ');
}

/**
 * Format a date for voice output
 * Example: Date -> "quince de enero de dos mil veinticuatro"
 */
export function formatDateForVoice(date: Date): string {
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  const dayWord = day === 1 ? 'primero' : numberToSpanishWords(day);
  const yearWord = numberToSpanishWords(year);

  return `${dayWord} de ${month} de ${yearWord}`;
}

/**
 * Format consumption in cubic meters for voice
 * Example: 15.5 -> "quince punto cinco metros cúbicos"
 */
export function formatConsumptionForVoice(m3: number): string {
  const intPart = Math.floor(m3);
  const decPart = Math.round((m3 - intPart) * 10);

  let result = numberToSpanishWords(intPart);

  if (decPart > 0) {
    result += ` punto ${numberToSpanishWords(decPart)}`;
  }

  result += intPart === 1 && decPart === 0 ? ' metro cúbico' : ' metros cúbicos';

  return result;
}

/**
 * Format folio for voice output
 * Example: "REP-20250201-0001" -> "reporte guión dos cero dos cinco cero dos cero uno guión cero cero cero uno"
 */
export function formatFolioForVoice(folio: string): string {
  const parts = folio.split('-');

  // Map category codes to spoken words
  const categorySpoken: Record<string, string> = {
    'CEA': 'ce e a',
    'REP': 'reporte',
    'CON': 'consulta',
    'FAC': 'facturación',
    'CTR': 'contrato',
    'CVN': 'convenio',
    'SRV': 'servicio',
    'CNS': 'consumo'
  };

  return parts.map((part, index) => {
    // First part is usually the category code
    if (index === 0 && categorySpoken[part]) {
      return categorySpoken[part];
    }
    // Spell out numbers
    if (/^\d+$/.test(part)) {
      return spellDigits(part);
    }
    // For mixed alphanumeric, spell character by character
    return part.split('').map(char => {
      if (/[0-9]/.test(char)) {
        return spellDigits(char);
      }
      return char.toLowerCase();
    }).join(' ');
  }).join(' guión ');
}
