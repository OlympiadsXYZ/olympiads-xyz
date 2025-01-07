// Section -> Chapter -> Module


export type SectionID =
  // | 'general'
  // | 'bronze'
  // | 'silver'
  // | 'gold'
  // | 'plat'
  // | 'adv'
  | 'general'
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'special'
  | 'beyond';

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
  beginner: [
    
  ],
  intermediate: [
    
  ],
  advanced: [
    
  ],
  special: [
    
  ],
  beyond: [
    
  ],
};

export default MODULE_ORDERING;
export const SECTIONS: SectionID[] = Object.keys(
  MODULE_ORDERING
) as SectionID[];
export const SECTION_LABELS: { [key in SectionID]: string } = {
  general: 'Предговор',
  beginner: 'Начинаещ 7-8 клас',
  intermediate: 'Междинен 9-10 клас',
  advanced: 'Напреднал 11-12 клас',
  special: 'Специален',
  beyond: 'Отвъд',
} as const;
export const SECTION_SEO_DESCRIPTION: { [key in SectionID]: string } = {
  general:
    'Обща информация за какво представлява този сайт, как да го ползвате и какво са олимпиадите и състезанията по природни науки.',
  beginner:
    'Секция, която включва подходящ материал на ниво 7-8 клас, нужен при подготовката за олимпиадите и състезания по природни науки.',
  intermediate:
    'Секция, която включва подходящ материал на ниво 9-10 клас, нужен при подготовката за олимпиадите и състезания по природни науки.',
  advanced:
    'Секция, която включва подходящ материал на ниво 11-12 клас, нужен при подготовката за олимпиадите и състезания по природни науки.',
  special:
    'Секция, която включва допълнителен материал на по-високо ниво, нужен при подготовката за Международните олимпиади по природни науки.',
  beyond:
    'Секция, която включва материал отвъд учебния план в училищата, както и отвъд стандарта на олимпиадите, но който задълбочава знанията на състезателите, особено на тези с напреднали интереси. Включва "университетски" теми и всичко на високо ниво, неподходящо за останалите секции.',
};
export const SECTION_SEO_TITLES: { [key in SectionID]: string } = {
  general: 'Предговор',
  beginner: 'Начинаещ 7-8 клас',
  intermediate: 'Междинен 9-10 клас',
  advanced: 'Напреднал 11-12 клас',
  special: 'Специален, международния кръг',
  beyond: 'Отвъд, по-надълбоко',
};

const moduleIDToSectionMap: { [key: string]: SectionID } = {};

SECTIONS.forEach(section => {
  MODULE_ORDERING[section].forEach(category => {
    category.items.forEach(moduleID => {
      moduleIDToSectionMap[moduleID] = section;
    });
  });
});

export { moduleIDToSectionMap, moduleIDToURLMap };

const moduleIDToURLMap: { [key: string]: string } = {};

SECTIONS.forEach(section => {
  MODULE_ORDERING[section].forEach(category => {
    category.items.forEach(moduleID => {
      moduleIDToURLMap[moduleID] = `/${section}/${moduleID}`;
    });
  });
});
