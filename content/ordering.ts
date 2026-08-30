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
  | 'physics/olymp';

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
      items: [
        'p78-pravolineino-dvizhenie',
        'p78-otnositelno-dvizhenie',
        'p78-okrazhnost-i-hvarlyaniya',
      ],
    },
    {
      name: 'Динамика',
      items: [
        'p78-forces-newton-laws',
        'p78-momentum-com',
        'p78-statics-hydrostatics',
      ],
    },
    {
      name: 'Работа и енергия',
      items: ['p78-work-power', 'p78-energy'],
    },
    {
      name: 'Топлинни явления',
      items: ['p78-heat-calorimetry', 'p78-phase-transitions'],
    },
    {
      name: 'Електричество',
      items: ['p78-electrostatics', 'p78-dc-circuits'],
    },
    {
      name: 'Геометрична оптика',
      items: ['p78-reflection-refraction', 'p78-lenses'],
    },
    {
      name: 'Математически апарат',
      items: ['p78-vectors', 'p78-functions-trig'],
    },
  ],
  'physics/9-10': [
    {
      name: 'Гравитация',
      items: ['p910-circular-orbits', 'p910-kepler'],
    },
    {
      name: 'Трептения',
      items: ['p910-harmonic-motion', 'p910-oscillations-energy'],
    },
    {
      name: 'Динамика на твърдо тяло',
      items: ['p910-moment-of-inertia', 'p910-rolling-angular-momentum'],
    },
    {
      name: 'Постоянен ток',
      items: ['p910-kirchhoff-slozhni-verigi', 'p910-uredi-nelineini-elementi'],
    },
    {
      name: 'Геометрична оптика',
      items: ['p910-sistemi-leshti-ogledala', 'p910-fermat-debeli-leshti'],
    },
    {
      name: 'Математически апарат',
      items: ['p910-derivatives', 'p910-integrals'],
    },
  ],
  'physics/11-12': [
    {
      name: 'Механика',
      items: ['p1112-damped-driven-oscillations', 'p1112-noninertial-frames'],
    },
    {
      name: 'Електромагнетизъм',
      items: [
        'p1112-gauss-potential',
        'p1112-capacitors-dipoles',
        'p1112-magnetostatics',
        'p1112-induction-circuits',
      ],
    },
    {
      name: 'Термодинамика',
      items: ['p1112-first-law-processes', 'p1112-mkt-real-gases'],
    },
    {
      name: 'Статистическа физика',
      items: ['p1112-distributions-entropy'],
    },
    {
      name: 'Специална теория на относителността',
      items: ['p1112-sr-kinematics', 'p1112-relativistic-dynamics'],
    },
    {
      name: 'Математически апарат',
      items: ['p1112-taylor-complex-ode'],
    },
  ],
  'physics/olymp': [
    {
      name: 'Подготовка за подбора',
      items: ['polymp-selection'],
    },
    {
      name: 'Механика',
      items: ['polymp-mechanics-morin-kleppner', 'polymp-lagrangian'],
    },
    {
      name: 'Електромагнетизъм',
      items: ['polymp-purcell-electrodynamics', 'polymp-circuits-oscillations'],
    },
    {
      name: 'Термодинамика',
      items: ['polymp-olympiad-thermo'],
    },
    {
      name: 'Вълни и оптика',
      items: ['polymp-wave-optics'],
    },
    {
      name: 'Относителност',
      items: ['polymp-special-relativity'],
    },
    {
      name: 'Модерна физика',
      items: ['polymp-quantum-atomic'],
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
};
export const SECTION_SEO_TITLES: { [key in SectionID]: string } = {
  general: 'Предговор',
  'physics/7-8': 'Физика · 7–8 клас',
  'physics/9-10': 'Физика · 9–10 клас',
  'physics/11-12': 'Физика · 11–12 клас',
  'physics/olymp': 'Физика · Подбор и международни олимпиади',
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
