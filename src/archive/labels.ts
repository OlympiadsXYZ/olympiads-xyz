// Bulgarian labels + helpers for the catalog-driven archive.
// Every map has an open set: unknown codes fall back to the raw code so a
// regenerated catalog never breaks the UI.

export type CompetitionMeta = { slug: string; name: string; short: string };

export const COMPETITION_META: { [code: string]: CompetitionMeta } = {
  NOF: { slug: 'nof', name: 'Национална олимпиада по физика', short: 'НОФ' },
  PSF: { slug: 'psf', name: 'Пролетно национално състезание по физика', short: 'НПСФ' },
  ESF: { slug: 'esf', name: 'Есенно национално състезание по физика', short: 'НЕСФ' },
  IPhO: { slug: 'ipho', name: 'Международна олимпиада по физика', short: 'IPhO' },
  IdPhO: { slug: 'idpho', name: 'Международна дистанционна олимпиада по физика', short: 'IdPhO' },
  APhO: { slug: 'apho', name: 'Азиатска олимпиада по физика', short: 'APhO' },
  EuPhO: { slug: 'eupho', name: 'Европейска олимпиада по физика', short: 'EuPhO' },
  IZhO: { slug: 'izho', name: 'Международна олимпиада „Жаутиков“', short: 'IZhO' },
  USAPhO: { slug: 'usapho', name: 'Олимпиада по физика на САЩ', short: 'USAPhO' },
  IEPhO: { slug: 'iepho', name: 'Международна експериментална олимпиада по физика', short: 'IEPhO' },
  RMPh: { slug: 'rmph', name: 'Румънски майстори по физика', short: 'RMPh' },
  IOM: { slug: 'iom', name: 'Олимпиада на мегаполисите', short: 'IOM' },
  IYPT: { slug: 'iypt', name: 'Международен турнир на младите физици', short: 'IYPT' },
  IYNT: { slug: 'iynt', name: 'Международен турнир на младите природоизпитатели', short: 'IYNT' },
  OPB: { slug: 'opb', name: 'Online Physics Brawl', short: 'OPB' },
  'Балкански': { slug: 'balkanski', name: 'Турнир „Минко Балкански“', short: 'Балкански' },
  'X-ENS': { slug: 'x-ens', name: 'Конкурс X-ENS (Франция)', short: 'X-ENS' },
  'ПУ': { slug: 'pu', name: 'Състезание на ПУ „Паисий Хилендарски“', short: 'ПУ' },
  'Всерусийска': { slug: 'vsosh-phys', name: 'Всерусийска олимпиада по физика', short: 'ВсОШ' },
  'Московска': { slug: 'mos-phys', name: 'Московска олимпиада по физика', short: 'МОФ (Москва)' },
  NAO: { slug: 'nao', name: 'Национална олимпиада по астрономия', short: 'НОА' },
  IAO: { slug: 'iao', name: 'Международна астрономическа олимпиада', short: 'IAO' },
  IOAA: { slug: 'ioaa', name: 'Международна олимпиада по астрономия и астрофизика', short: 'IOAA' },
  GeCAA: { slug: 'gecaa', name: 'Глобално електронно състезание по астрономия и астрофизика', short: 'GeCAA' },
  'VsOA-ru': { slug: 'vsoa', name: 'Всерусийска олимпиада по астрономия', short: 'ВсОА' },
  'ZAO-ru': { slug: 'zao', name: 'Задочна руска олимпиада по астрономия', short: 'ЗАО' },
  MosA: { slug: 'mosa', name: 'Московска олимпиада по астрономия', short: 'МАО' },
  SPbA: { slug: 'spba', name: 'Санкт-Петербургска олимпиада по астрономия', short: 'СПбАО' },
  APAO: { slug: 'apao', name: 'Азиатско-тихоокеанска олимпиада по астрономия', short: 'APAO' },
  SAO: { slug: 'sao', name: 'Сингапурска олимпиада по астрономия', short: 'SAO' },
  Nikola: { slug: 'nikola', name: 'Тренировъчна колекция „Никола“', short: 'Никола' },
  NOH: { slug: 'noh', name: 'Национална олимпиада по химия', short: 'НОХ' },
  HOOS: { slug: 'hoos', name: 'Национално състезание по ХООС', short: 'ХООС' },
  IChO: { slug: 'icho', name: 'Международна олимпиада по химия', short: 'IChO' },
  IMChO: { slug: 'imcho', name: 'Международна Менделеевска олимпиада', short: 'IMChO' },
  iGeo: { slug: 'igeo', name: 'Международна олимпиада по география', short: 'iGeo' },
};

const SLUG_TO_CODE: { [slug: string]: string } = {};
Object.keys(COMPETITION_META).forEach(code => {
  SLUG_TO_CODE[COMPETITION_META[code].slug] = code;
});

const CYR_TO_LAT: { [ch: string]: string } = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht',
  ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

export function competitionSlug(code: string): string {
  if (COMPETITION_META[code]) return COMPETITION_META[code].slug;
  return code
    .toLowerCase()
    .split('')
    .map(c => CYR_TO_LAT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function competitionFromSlug(slug: string): string | null {
  return SLUG_TO_CODE[slug] ?? null;
}

export function competitionName(code: string): string {
  return COMPETITION_META[code]?.name ?? code;
}

export function competitionShort(code: string): string {
  return COMPETITION_META[code]?.short ?? code;
}

export const ROUND_LABELS: { [code: string]: string } = {
  I: 'I кръг (общински)',
  II: 'II кръг (областен)',
  III: 'III кръг (национален)',
  IV: 'IV кръг',
  theory: 'Теоретичен тур',
  experiment: 'Експериментален тур',
  practical: 'Практически тур',
  observational: 'Наблюдателен тур',
  'data-analysis': 'Анализ на данни',
  team: 'Отборен тур',
  selection: 'Подбор',
  regional: 'Областен кръг',
  creative: 'Творчески тур',
  distance: 'Задочен кръг',
};

export const ROUND_ORDER = [
  'I', 'II', 'III', 'IV', 'regional', 'selection',
  'theory', 'experiment', 'practical', 'observational',
  'data-analysis', 'team', 'creative', 'distance',
];

export const TYPE_LABELS: { [code: string]: string } = {
  problems: 'Условия',
  solutions: 'Решения',
  answers: 'Отговори',
  results: 'Резултати',
  data: 'Данни',
  translation: 'Превод',
  book: 'Книга',
  handout: 'Материал',
  other: 'Друго',
};

export const TYPE_ORDER = [
  'problems', 'solutions', 'answers', 'data', 'translation',
  'results', 'book', 'handout', 'other',
];

export const LANG_LABELS: { [code: string]: string } = {
  bg: 'БГ', en: 'EN', ru: 'РУ', mk: 'МК', kk: 'КЗ', ro: 'РО', cs: 'ЧЕ', fr: 'ФР',
};

export const SCIENCE_LABELS: { [code: string]: string } = {
  physics: 'Физика',
  astronomy: 'Астрономия',
  chemistry: 'Химия',
  geography: 'География',
  math: 'Математика',
  informatics: 'Информатика',
  biology: 'Биология',
};

export const SCIENCE_COLORS: { [code: string]: { bg: string; text: string } } = {
  physics: { bg: 'bg-blue-700 dark:bg-blue-900', text: 'text-blue-100' },
  astronomy: { bg: 'bg-indigo-700 dark:bg-indigo-900', text: 'text-indigo-100' },
  chemistry: { bg: 'bg-red-700 dark:bg-red-900', text: 'text-red-100' },
  geography: { bg: 'bg-yellow-700 dark:bg-yellow-800', text: 'text-yellow-100' },
  math: { bg: 'bg-green-700 dark:bg-green-900', text: 'text-green-100' },
  informatics: { bg: 'bg-sky-700 dark:bg-sky-900', text: 'text-sky-100' },
};

export function groupLabel(group: string | null): string | null {
  if (!group) return null;
  if (group === 'ST') return 'Старша';
  if (group === 'ML') return 'Младша';
  if (group === 'alpha') return 'Група α';
  if (group === 'beta') return 'Група β';
  if (/^[0-9]/.test(group)) return `${group} клас`;
  return group;
}

export function label(map: { [code: string]: string }, code: string | null): string | null {
  if (!code) return null;
  return map[code] ?? code;
}

export function formatBytes(n: number): string {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = v >= 100 || i === 0 ? Math.round(v).toString() : v.toFixed(1).replace('.', ',');
  return `${s} ${units[i]}`;
}

export function entryExt(file: string): string {
  const ext = (file.split('.').pop() ?? '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'tex'].includes(ext)) return 'doc';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff'].includes(ext)) return 'img';
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return 'zip';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'xls';
  if (['djvu', 'epub'].includes(ext)) return 'book';
  return 'other';
}

// The hosted base URL for archive files (R2 bucket / custom domain).
// GATSBY_-prefixed so it's inlined into client bundles at build time.
export const ARCHIVE_BASE_URL = (process.env.GATSBY_ARCHIVE_BASE_URL || '').replace(/\/$/, '');

export function entryUrl(key: string): string | null {
  if (!ARCHIVE_BASE_URL) return null;
  return `${ARCHIVE_BASE_URL}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
