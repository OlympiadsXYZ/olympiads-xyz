// Ниво (site-wide selector) -> Секция -> Категория -> Модул
// (docs/Structure.md; source docs: `modules`, `intro`, `plan-phys`)
//
// Sections are science fields whose IDs double as URL paths
// (/mechanics/<module-id>). The level is NEVER part of the URL — it is a
// site-wide filter (LevelContext): a chapter is visible on a section page
// only when its `levels` include the active level (no `levels` = always).

export type Level = '7-8' | '9-10' | '11-12' | 'olymp';

export const LEVELS: Level[] = ['7-8', '9-10', '11-12', 'olymp'];

export const LEVEL_LABELS: { [key in Level]: string } = {
  '7-8': '7–8 клас',
  '9-10': '9–10 клас',
  '11-12': '11–12 клас',
  olymp: 'Специална тема',
};

export const DEFAULT_LEVEL: Level = '9-10';

export type SectionID =
  | 'general'
  | 'mechanics'
  | 'thermodynamics'
  | 'electromagnetism'
  | 'optics'
  | 'modern-physics'
  | 'astronomy';

export type Chapter = {
  name: string;
  items: string[];
  description?: string;
  levels?: Level[];
};

const MODULE_ORDERING: { [key in SectionID]: Chapter[] } = {
  general: [
    {
      name: 'Обща информация',
      description: 'Какво представлява този сайт и как да го използвате.',
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
      description: 'Как вие можете да ни помогнете.',
      items: [
        'contributing',
        'become-author',
        'adding-solutions',
        'editor-work-mdx',
      ],
    },
    {
      name: 'Математически апарат',
      description: 'Вектори, функции, координатни системи и тригонометрия.',
      levels: ['7-8'],
      items: [],
    },
    {
      name: 'Математически апарат',
      description:
        'Математически анализ: граници, производни, интеграли и приложението им във физиката.',
      levels: ['9-10'],
      items: [],
    },
    {
      name: 'Математически апарат',
      description:
        'Висша математика: диференциални уравнения, ред на Тейлър, комплексни числа.',
      levels: ['11-12', 'olymp'],
      items: [],
    },
    {
      name: 'Експерименти',
      description:
        'Експериментална техника, статистика, анализ на данни и грешки.',
      levels: ['9-10', '11-12', 'olymp'],
      items: [],
    },
  ],
  mechanics: [
    // 7–8 (plan-phys, 1 ниво)
    {
      name: 'Кинематика',
      description:
        'Движение с постоянна скорост и ускорение, относително движение, окръжност, хвърляния.',
      levels: ['7-8'],
      items: [],
    },
    {
      name: 'Динамика',
      description:
        'Сили, принципи на Нютон, импулс, момент на сила, Архимед и хидростатика.',
      levels: ['7-8'],
      items: [],
    },
    {
      name: 'Работа и енергия',
      description: 'Работа, мощност, кинетична и потенциална енергия, ЗЗЕ.',
      levels: ['7-8'],
      items: [],
    },
    // 9–10 (plan-phys, 2 ниво)
    {
      name: 'Гравитация',
      description:
        'Кръгови и елиптични орбити, закони на Кеплер, момент на импулса.',
      levels: ['9-10'],
      items: [],
    },
    {
      name: 'Трептения',
      description:
        'Уравнение на хармоничното трептене — динамичен и енергетичен подход.',
      levels: ['9-10'],
      items: [],
    },
    {
      name: 'Динамика на твърдо тяло',
      description:
        'Инерчен момент, теорема на Щайнер, търкаляне без хлъзгане, ЗЗМИ.',
      levels: ['9-10'],
      items: [],
    },
    // 11–12 (plan-phys, 3 ниво)
    {
      name: 'Осцилации',
      description: 'Затихващи и принудени трептения, резонанс.',
      levels: ['11-12'],
      items: [],
    },
    {
      name: 'Относителност на движението',
      description: 'Неинерциални отправни системи, инерчни сили, Кориолис.',
      levels: ['11-12'],
      items: [],
    },
    // Специална тема (една категория ≈ един handout на Zhou; Кинематика = M1)
    {
      name: 'Кинематика',
      description:
        'Диференциални уравнения на движението, трикове с отправни системи, двумерно движение и оптимални траектории — по Zhou M1.',
      levels: ['olymp'],
      items: ['st-kin-odes', 'st-kin-tricks', 'st-kin-2d', 'st-kin-optimal'],
    },
    {
      name: 'Динамика на материална точка',
      description: 'Morin/Kleppner ниво: сили, ЗЗИ, ЗЗМИ, виртуална работа.',
      levels: ['olymp'],
      items: [],
    },
    {
      name: 'Динамика на идеално твърдо тяло',
      description: 'Триизмерно въртене, физично махало, жироскопи.',
      levels: ['olymp'],
      items: [],
    },
    {
      name: 'Еластични свойства на реални твърди тела',
      description: 'Деформации, закон на Хук, енергия на деформация.',
      levels: ['olymp'],
      items: [],
    },
    {
      name: 'Механика на флуиди',
      description: 'Хидростатика, Бернули, вискозитет, реални флуиди.',
      levels: ['olymp'],
      items: [],
    },
    {
      name: 'Механични вълни',
      description: 'Вълново уравнение, стоящи вълни, звук.',
      levels: ['olymp'],
      items: [],
    },
  ],
  thermodynamics: [
    {
      name: 'Основни понятия',
      description:
        'Агрегатни състояния, температура, топлопроводимост, конвекция и излъчване.',
      levels: ['7-8'],
      items: [],
    },
    {
      name: 'Топлообмен',
      description:
        'Топлинен капацитет, топене и изпарение, топлинен баланс.',
      levels: ['7-8'],
      items: [],
    },
    {
      name: 'Термодинамика',
      description:
        'Идеален газ, първи принцип, адиабати, политропни процеси, реален газ.',
      levels: ['11-12'],
      items: [],
    },
    {
      name: 'Статистическа физика',
      description:
        'Разпределения на Максуел и Болцман, ентропия, фазови преходи.',
      levels: ['11-12'],
      items: [],
    },
    {
      name: 'Олимпиадна термодинамика',
      description:
        'Blundell/Wang-Ricardo ниво: квантова статистика, излъчване, повърхностно напрежение.',
      levels: ['olymp'],
      items: [],
    },
  ],
  electromagnetism: [
    {
      name: 'Електростатика',
      description:
        'Закон на Кулон, електрично поле, потенциал, суперпозиция.',
      levels: ['7-8'],
      items: [],
    },
    {
      name: 'Постоянен ток',
      description:
        'Закон на Ом, свързване на резистори, работа и мощност на тока.',
      levels: ['7-8'],
      items: [],
    },
    {
      name: 'Постоянен ток',
      description:
        'Правила на Кирхоф, амперметри и волтметри, сложни схеми.',
      levels: ['9-10'],
      items: [],
    },
    {
      name: 'Електричество',
      description:
        'Дипол, кондензатори, теорема на Гаус, трептения в електрична верига.',
      levels: ['11-12'],
      items: [],
    },
    {
      name: 'Магнетизъм',
      description:
        'Магнитно поле на ток, Ампер, Лоренц, индукция, RLC, уравнения на Максуел.',
      levels: ['11-12'],
      items: [],
    },
    {
      name: 'Олимпиаден електромагнетизъм',
      description:
        'Purcell/Griffiths ниво: метод на изображенията, излъчване, електродинамика.',
      levels: ['olymp'],
      items: [],
    },
  ],
  optics: [
    {
      name: 'Светлина',
      description:
        'Отражение и пречупване, плоско огледало, лещи и построяване на изображения.',
      levels: ['7-8'],
      items: [],
    },
    {
      name: 'Оптични системи',
      description: 'Камера, телескоп, микроскоп, човешкото око.',
      levels: ['7-8'],
      items: [],
    },
    {
      name: 'Геометрична оптика',
      description:
        'Снелиус, пълно вътрешно отражение, системи от лещи и огледала, принцип на Ферма.',
      levels: ['9-10', '11-12'],
      items: [],
    },
    {
      name: 'Вълнова оптика',
      description: 'Интерференция, дифракция, поляризация.',
      levels: ['olymp'],
      items: [],
    },
  ],
  'modern-physics': [
    {
      name: 'Специална теория на относителността',
      description:
        'Лоренцови трансформации, релативистки импулс и енергия, ефект на Доплер.',
      levels: ['11-12', 'olymp'],
      items: [],
    },
    {
      name: 'Квантова физика',
      description:
        'Фотоефект, атоми и ядра, радиоактивен разпад, светлинно налягане.',
      levels: ['olymp'],
      items: [],
    },
  ],
  astronomy: [
    {
      name: 'Координатни системи и време',
      description:
        'Небесна сфера, екваториална/хоризонтална/еклиптична КС, звездно време.',
      items: [],
    },
    {
      name: 'Небесна механика',
      description:
        'Закони на Кеплер, космически скорости, видове орбити и трансфери.',
      items: [],
    },
    {
      name: 'Телескопи',
      description:
        'Видове телескопи, характеристики, критерий на Рейли, системи.',
      items: [],
    },
    {
      name: 'Физика на планети и звезди',
      description: 'Излъчване на звездите, ядрени реакции, планетни процеси.',
      items: [],
    },
    {
      name: 'Звездни наблюдения',
      description:
        'Звездни величини, филтри, поглъщане, цветови ексцес.',
      items: [],
    },
    {
      name: 'Галактическа астрономия',
      description: 'Въртене и видове галактики, ефект на Доплер.',
      items: [],
    },
    {
      name: 'Извънгалактическа астрономия',
      description: 'Основи на космологията, закон на Хъбъл, ранна Вселена.',
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
  mechanics: 'Механика',
  thermodynamics: 'Термодинамика',
  electromagnetism: 'Електромагнетизъм',
  optics: 'Оптика',
  'modern-physics': 'Модерна физика',
  astronomy: 'Астрономия',
} as const;
export const SECTION_SEO_DESCRIPTION: { [key in SectionID]: string } = {
  general:
    'Обща информация за какво представлява този сайт, как да го ползвате и какво са олимпиадите и състезанията по природни науки.',
  mechanics:
    'Механика за олимпиади по физика — кинематика, динамика, енергия, гравитация, трептения и твърдо тяло, от първите стъпки до нивото на IPhO.',
  thermodynamics:
    'Термодинамика за олимпиади по физика — топлинни явления, идеален газ, статистическа физика, от училищното ниво до IPhO.',
  electromagnetism:
    'Електромагнетизъм за олимпиади по физика — електростатика, вериги, магнетизъм и индукция, от училищното ниво до IPhO.',
  optics:
    'Оптика за олимпиади по физика — геометрична и вълнова оптика, лещи, огледала и оптични уреди.',
  'modern-physics':
    'Модерна физика за олимпиади — специална теория на относителността, квантова и атомна физика.',
  astronomy:
    'Модули по астрономия — координатни системи, небесна механика, телескопи, звезди и космология — за националната олимпиада по астрономия, IAO и IOAA.',
};
export const SECTION_SEO_TITLES: { [key in SectionID]: string } = {
  general: 'Предговор',
  mechanics: 'Механика',
  thermodynamics: 'Термодинамика',
  electromagnetism: 'Електромагнетизъм',
  optics: 'Оптика',
  'modern-physics': 'Модерна физика',
  astronomy: 'Астрономия',
};

// Chapters visible at a given level (no `levels` on a chapter = visible at all)
export const chaptersForLevel = (
  section: SectionID,
  level: Level
): Chapter[] =>
  MODULE_ORDERING[section].filter(
    chapter => !chapter.levels || chapter.levels.includes(level)
  );

// Sections that have any content at a given level (drives nav visibility)
export const sectionsForLevel = (level: Level): SectionID[] =>
  SECTIONS.filter(section => chaptersForLevel(section, level).length > 0);

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
