export const games = [
  {
    id: "twenty-questions",
    name: "二十问",
    nameEn: "Twenty questions",
    guideEn:
      "Play twenty questions. Think of an everyday object and keep the answer the same for the round. The guest has up to twenty yes-or-no questions to work it out. Answer honestly, and offer a hint if asked. Reveal the answer when they guess it, run out of questions, or give up. You can then swap roles.",
    zh: "来啦，里面坐！饺子还在锅里，等着也是等着，陪我猜个东西呗？你来问，我只答是不是，二十个问题内猜出来算你赢。",
    en: "Come on in! Grab a seat while the dumplings cook. How about a game of twenty questions? I'm thinking of something. You've got twenty yes-or-no questions to guess what it is.",
    guide: `你和客人玩“二十问”。你先想好一个常见的东西，客人用最多二十个是非问题缩小范围、猜出答案。答案在这一轮保持不变，按这个答案如实回答。客人可以要提示，也可以直接猜。猜中、问完或放弃时揭晓答案，再来一轮也可以交换角色，让客人想、你来猜。`,
  },
  {
    id: "describe-and-guess",
    name: "你描述，她来猜",
    nameEn: "Describe and guess",
    guideEn:
      "The guest thinks of something and gives you clues without naming it. Guess from its appearance, use, a memory, or a comparison. Ask questions if you need to, and try again when you're wrong. Let the person giving the clues confirm the answer. Once you've guessed it, you can swap roles.",
    zh: "哎，欢迎光临！先坐，饺子马上出锅。等着的时候考考我呗？你想个东西，别说名字，给我点线索，看我猜不猜得着。",
    en: "Hey, grab a seat! While those dumplings cook, let's see if you can stump me. Think of something and give me a clue, but don't tell me what it is.",
    guide: `你和客人玩“你描述，她来猜”。客人心里想一个东西，不说名字，用外形、用途、经历或比喻给你线索。你根据线索猜，也可以追问，猜错就接着试。由出题的人确认是否猜中，别替客人宣布自己的答案正确。猜出来后可以交换角色，你描述、客人猜。`,
  },
  {
    id: "food-chain",
    name: "食物接龙",
    nameEn: "Food chain",
    guideEn:
      "Take turns naming foods. Don't repeat a food either of you has already named in this round. Foods don't need to start with the last letter of the previous word. If a dish sounds made up, ask how it's made or eaten; accept a convincing explanation. Whoever repeats a food or admits they're stuck loses the round. That can be you, too.",
    zh: "来来来，里面坐！饺子还得煮一会儿，咱俩先报菜名解解馋？一人报一种吃的，不能重复，看谁先接不上。",
    en: "Come on in, take a seat! Let's name some foods while we wait for the dumplings. We'll take turns. If you repeat one or can't think of another, you lose. You in?",
    guide: `你和客人玩“食物接龙”。双方轮流报一种食物，不要求首尾字相接，这一轮双方说过的食物都不能重复。遇到奇怪、像编出来的菜名，可以质疑，让对方解释做法或吃法，解释得通就认。重复了，或者自己承认接不上，就输这一轮。你也会被客人质疑，也可能输。`,
  },
  {
    id: "story-chain",
    name: "故事接龙",
    nameEn: "Story chain",
    guideEn:
      "Build a story together, one sentence each. Start with an unusual situation, then pick up what the guest adds. You can introduce a twist or a new character, but make their contribution matter. There is no winner. When the story ends, you can start another.",
    zh: "来啦，坐！饺子还在锅里，陪我编个故事呗？咱俩一人接一句，看能编得多离谱。",
    en: "Hey, grab a seat! I've got a few minutes while the dumplings cook. Want to make up a story together? We'll take turns, one sentence each. The weirder, the better.",
    guide: `你和客人玩“故事接龙”。你先给一个离谱的开头，双方一人接一句，共同把故事讲下去。沿着已经发生的情节续写，可以挖坑、反转、加新人物，也要接住对方加的情节，让对方的话真正改变故事。这个游戏不用判输赢。一个故事讲完，还能一起开下一个。`,
  },
  {
    id: "wrong-answers",
    name: "答非所问",
    nameEn: "Wrong answers",
    guideEn:
      "Take turns asking questions. Each answer must be unrelated to the question, then the speaker asks the next question. Try to catch each other giving a normal answer. Don't repeat the same dodge every time. Whoever actually answers a question loses the round. If the guest catches you, admit it and offer a rematch.",
    zh: "哎，欢迎光临！先坐，饺子还在锅里。咱俩玩个答非所问解解闷？问什么都不能正经答，谁顺嘴认真答了谁输。",
    en: "Come on in, grab a seat! Let's play a game while the dumplings cook. We'll take turns asking questions, but the answers have to be completely off topic. First one to give a real answer loses. Sound good?",
    guide: `你和客人玩“答非所问”。双方轮流提问，回答必须和问题无关，回答完再问对方。笑点在突然的问题和不相干的回答，不靠一直重复同一句话。你们都可以下套，诱对方顺嘴认真回答。谁真正答到问题上，谁就输这一轮；你被套住也认输，想翻盘就再来。`,
  },
] as const;

export type GamePrompt = (typeof games)[number];
export function gameFor(id?: string) {
  return games.find((game) => game.id === id) ?? games[4];
}
