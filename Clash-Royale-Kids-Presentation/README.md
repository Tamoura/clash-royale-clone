# 📚 Game Guide for Kids / دليل اللعبة للأطفال

A classroom-ready presentation that explains how this 3D battle game is built,
shows real code examples, gives AI prompts kids can use, and suggests future
features to encourage them to keep developing.

عرضٌ جاهز للصف يشرح كيف بُنِيَت هذه اللعبة ثلاثية الأبعاد، ويُريك أمثلة كود
حقيقية، ويُعطي أوامر للذكاء الاصطناعي، ويقترِح ميزات مستقبلية لِتشجيع الأطفال
على مواصلة التطوير.

## Files / الملفات

**📊 PDF slide decks (ready to present / print):**

| Language | PDF | Slide source |
|---|---|---|
| 🇬🇧 English | [`game-slides-en.pdf`](./game-slides-en.pdf) | [`slides-en.md`](./slides-en.md) |
| 🇸🇦 العربية (Arabic) | [`game-slides-ar.pdf`](./game-slides-ar.pdf) | [`slides-ar.md`](./slides-ar.md) |

**📖 Full booklet guides (with screenshots, for reading):**

| Language | File |
|---|---|
| 🇬🇧 English | [`game-guide-en.md`](./game-guide-en.md) |
| 🇸🇦 العربية (Arabic) | [`game-guide-ar.md`](./game-guide-ar.md) |

Screenshots live in [`img/`](./img/). To re-build the PDFs after editing the
slides, run (needs the [Marp CLI](https://github.com/marp-team/marp-cli) and a
local Chrome):

```sh
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx @marp-team/marp-cli docs/slides-en.md --pdf --allow-local-files -o docs/game-slides-en.pdf
```

## How to use it / كيفية الاستخدام

- **Read as a handout:** open either file — it reads top-to-bottom like a booklet.
- **Use as slides:** each section is separated by `---`, so you can paste the
  file into a slideshow tool (such as [Marp](https://marp.app) or reveal.js)
  and it becomes a slide deck automatically.
- **Audience:** around 6th grade (ages 11–12). No coding experience needed.

— يمكن قراءة كل ملف ككُتيِّب، أو استخدامه كشرائح عرض (كل شريحة مفصولة بـ `---`).

## Tip / نصيحة

Encourage kids to run the game first (`npm install`, then `npm run dev`),
change one number in `src/game/cards.ts`, and watch what happens. That first
small change is where the magic starts! ✨
