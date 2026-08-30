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
    {
      name: 'Кинематика',
      description: 'Движение, скорост, ускорение, окръжност и хвърляния.',
      items: [],
    },
    {
      name: 'Динамика',
      description: 'Сили, принципи на Нютон, импулс, статика и хидростатика.',
      items: [],
    },
    {
      name: 'Работа и енергия',
      description: 'Работа, мощност, кинетична и потенциална енергия.',
      items: [],
    },
    {
      name: 'Топлинни явления',
      description: 'Температура, топлообмен, фазови преходи.',
      items: [],
    },
    {
      name: 'Електричество',
      description: 'Електростатика и постоянен ток.',
      items: [],
    },
    {
      name: 'Геометрична оптика',
      description: 'Отражение, пречупване, лещи и уреди.',
      items: [],
    },
    {
      name: 'Математически апарат',
      description: 'Вектори, функции и тригонометрия за физици.',
      items: [],
    },
  ],
  'physics/9-10': [
    {
      name: 'Гравитация',
      description: 'Орбити, закони на Кеплер, космически скорости.',
      items: [],
    },
    {
      name: 'Трептения',
      description: 'Хармонично трептене, енергия, махала.',
      items: [],
    },
    {
      name: 'Динамика на твърдо тяло',
      description: 'Инерчен момент, търкаляне, момент на импулса.',
      items: [],
    },
    {
      name: 'Постоянен ток',
      description: 'Правила на Кирхоф, сложни вериги, уреди.',
      items: [],
    },
    {
      name: 'Геометрична оптика',
      description: 'Системи от лещи и огледала, принцип на Ферма.',
      items: [],
    },
    {
      name: 'Математически апарат',
      description: 'Производни, интеграли и прости диференциални уравнения.',
      items: [],
    },
  ],
  'physics/11-12': [
    {
      name: 'Механика',
      description: 'Затихващи и принудени трептения, неинерциални системи.',
      items: [],
    },
    {
      name: 'Електромагнетизъм',
      description: 'Гаус, кондензатори, магнитостатика, индукция и RLC.',
      items: [],
    },
    {
      name: 'Термодинамика',
      description: 'Първи принцип, процеси, МКТ и реални газове.',
      items: [],
    },
    {
      name: 'Статистическа физика',
      description: 'Разпределения, ентропия, втори принцип.',
      items: [],
    },
    {
      name: 'Специална теория на относителността',
      description: 'Кинематика и динамика на СТО.',
      items: [],
    },
    {
      name: 'Математически апарат',
      description: 'Ред на Тейлър, комплексни числа, диференциални уравнения.',
      items: [],
    },
  ],
  'physics/olymp': [
    {
      name: 'Подготовка за подбора',
      description: 'Как работи подборът и как се тренира за него.',
      items: [],
    },
    {
      name: 'Механика',
      description: 'Morin, Kleppner, лагранжев подход.',
      items: [],
    },
    {
      name: 'Електромагнетизъм',
      description: 'Purcell, сложни вериги и трептения.',
      items: [],
    },
    {
      name: 'Термодинамика',
      description: 'Олимпиадна термодинамика и статистическа физика.',
      items: [],
    },
    {
      name: 'Вълни и оптика',
      description: 'Вълнова оптика и интерференция.',
      items: [],
    },
    {
      name: 'Относителност',
      description: 'СТО на олимпиадно ниво.',
      items: [],
    },
    {
      name: 'Модерна физика',
      description: 'Квантова и атомна физика.',
      items: [],
    },
  ],
  astronomy: [
    {
      name: 'Координатни системи и време',
      description: 'Небесна сфера, координати, звездно време.',
      items: [],
    },
    {
      name: 'Небесна механика',
      description: 'Кеплер, гравитация, орбитални маневри.',
      items: [],
    },
    {
      name: 'Телескопи и наблюдения',
      description: 'Оптика на телескопа, наблюдателна астрономия.',
      items: [],
    },
    {
      name: 'Физика на звездите',
      description: 'Звездни величини, излъчване, еволюция.',
      items: [],
    },
    {
      name: 'Галактики и космология',
      description: 'Доплер, закон на Хъбъл, космология.',
      items: [],
    },
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
