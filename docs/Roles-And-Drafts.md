# Роли и чернови

## Роли

Три нива, реализирани чрез Firebase custom claims:

| Роля | Кой | Какво вижда/може |
|---|---|---|
| **admin** | Маргулан | Всички чернови на preview деплойите; всичко останало |
| **author** | автори на модули | Черновите на preview; редактира през /editor |
| (без роля) | всички потребители | Само публикуваното съдържание |

Задаване на роля (изисква service-account ключ на Firebase проекта):

```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/keys/olympiads-xyz-sa.json
node scripts/set-role.mjs margulan.is.2005@gmail.com admin
node scripts/set-role.mjs author@example.com author
```

Ролята се чете в клиента чрез `useStaffRole()` (custom claims от ID токена).
Потребителят трябва да излезе/влезе, за да се обнови токенът му.

## Чернови

- Черновите живеят в `drafts/modules/` и **никога не влизат в
  production билда** — нула изтичане на съдържание.
- При `GATSBY_INCLUDE_DRAFTS=true` (зададено само в **Preview**
  environment на Vercel) билдът ги сорсва и генерира:
  - `/drafts/` — индекс по раздели;
  - `/drafts/<id>/` — страница на чернова с banner „ЧЕРНОВА".
- Двете страници са допълнително гейтнати клиентски: без admin/author
  роля показват само съобщение за достъп.
- Преглед на черновите: отвори който и да е preview деплой (всеки push
  на branch) → `/drafts/`, влез с админ акаунта.

### Публикация на модул

1. Модулът се пренаписва по `docs/Module-Standard.md` (пътят: чернова →
   двоен adversarial преглед → човешки преглед).
2. Файлът се мести от `drafts/modules/...` в `content/...`.
3. ID-то се регистрира в `content/ordering.ts` (глава в секция).
4. Merge в `master` → продукция.

### Ограничения (честно)

- Preview URL-ите са необявени, но публични; клиентският гейт е
  „меко" ограничение (съдържанието е в page-data на preview билда).
  За твърда защита: Vercel Deployment Protection върху Preview
  (изисква Vercel login) — включва се от Settings → Deployment
  Protection, когато стане нужно.
- Firestore/editor права на авторите се управляват отделно (Firestore
  rules) — извън обхвата на този документ.
