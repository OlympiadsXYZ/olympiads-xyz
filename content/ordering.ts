// Section -> Chapter -> Module
//
// Sections follow science -> grade level (see docs/Structure.md):
// 'general' is the site-wide foreword; the rest are per-science levels
// whose IDs double as URL paths (e.g. /physics/7-8/<module-id>).

export type SectionID =
  | 'general'
  | 'physics/7-8'
  | 'physics/9-10'
  | 'physics/11-12'
  | 'physics/olymp'
  | 'astronomy';

export type Chapter = {
  name: string;
  items: string[];
  description?: string;
};

const MODULE_ORDERING: { [key in SectionID]: Chapter[] } = {
  general: [
    {
      name: 'Обща информация',
      description: "Какво представлява този сайт и как да го използвате.",
      items: [
        'general-intro',
        'about-us',
        'using-modules',
        'olymp-prep',
        'phys-resources',
        'discussions',
      ],
    },
    {
      name: 'Допринасяне към Olympiads XYZ',
      description: "Как вие можете да ни помогнете.",
      items: [
        'contributing',
        'become-author',
        'adding-solutions',
        'editor-work-mdx',
      ],
    }
  ],
  'physics/7-8': [

  ],
  'physics/9-10': [

  ],
  'physics/11-12': [

  ],
  'physics/olymp': [

  ],
  astronomy: [

  ],
};

export default MODULE_ORDERING;
export const SECTIONS: SectionID[] = Object.keys(
  MODULE_ORDERING
) as SectionID[];
export const SECTION_LABELS: { [key in SectionID]: string } = {
  general: 'Предговор',
  'physics/7-8': '7–8 клас',
  'physics/9-10': '9–10 клас',
  'physics/11-12': '11–12 клас',
  'physics/olymp': 'Подбор и международни',
  astronomy: 'Астрономия',
} as const;
export const SECTION_SEO_DESCRIPTION: { [key in SectionID]: string } = {
  general:
    'Обща информация за какво представлява този сайт, как да го ползвате и какво са олимпиадите и състезанията по природни науки.',
  'physics/7-8':
    'Физика за 7–8 клас — основите по механика, топлинни явления, електричество и геометрична оптика, необходими за първите стъпки в олимпиадите и състезанията по физика.',
  'physics/9-10':
    'Физика за 9–10 клас — материалът, нужен за областния и националния кръг на олимпиадата по физика и националните състезания.',
  'physics/11-12':
    'Физика за 11–12 клас — задълбоченият материал за националните кръгове, състезанията и кандидатстудентската подготовка по физика.',
  'physics/olymp':
    'Подготовка за подбора на националния отбор и за международните олимпиади по физика — IPhO, EuPhO, APhO и други.',
  astronomy:
    'Модули по астрономия — координатни системи, небесна механика, телескопи, звезди и космология — за националната олимпиада по астрономия, IAO и IOAA.',
};
export const SECTION_SEO_TITLES: { [key in SectionID]: string } = {
  general: 'Предговор',
  'physics/7-8': 'Физика · 7–8 клас',
  'physics/9-10': 'Физика · 9–10 клас',
  'physics/11-12': 'Физика · 11–12 клас',
  'physics/olymp': 'Физика · Подбор и международни олимпиади',
  astronomy: 'Астрономия',
};

const moduleIDToSectionMap: { [key: string]: SectionID } = {};

SECTIONS.forEach(section => {
  MODULE_ORDERING[section].forEach(category => {
    category.items.forEach(moduleID => {
      moduleIDToSectionMap[moduleID] = section;
    });
  });
});

const moduleIDToURLMap: { [key: string]: string } = {};

SECTIONS.forEach(section => {
  MODULE_ORDERING[section].forEach(category => {
    category.items.forEach(moduleID => {
      moduleIDToURLMap[moduleID] = `/${section}/${moduleID}`;
    });
  });
});

export { moduleIDToSectionMap, moduleIDToURLMap };
