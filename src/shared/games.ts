export const gameIds = [
  "twenty-questions",
  "describe-and-guess",
  "food-chain",
  "story-chain",
  "wrong-answers",
] as const;
export type GameId = (typeof gameIds)[number];
export type GameSelection = GameId | "random";
export const defaultGameId: GameId = "wrong-answers";
export interface Words {
  zh: string;
  en: string;
}
export const gameDefinitions = [
  {
    id: "twenty-questions",
    name: "二十问",
    en: "Twenty questions",
    hint: "她想一个东西，你用是非问题猜，也能交换角色。",
    hintEn: "Guess her object with yes-or-no questions, then swap roles.",
  },
  {
    id: "describe-and-guess",
    name: "你描述，她来猜",
    en: "Describe and guess",
    hint: "别说名字，给她线索，看她能不能猜出来。",
    hintEn: "Give her clues without saying the name. Can she guess it?",
  },
  {
    id: "food-chain",
    name: "食物接龙",
    en: "Food chain",
    hint: "轮流报吃的，不能重复；怪菜名可以质疑、解释。",
    hintEn: "Take turns naming foods. No repeats. Challenge strange dishes.",
  },
  {
    id: "story-chain",
    name: "故事接龙",
    en: "Story chain",
    hint: "一人接一句，把故事越编越离谱。",
    hintEn: "Build a ridiculous story together, one sentence each.",
  },
  {
    id: "wrong-answers",
    name: "答非所问",
    en: "Wrong answers",
    hint: "轮流提问，回答必须不相干，谁顺嘴答对谁输。",
    hintEn: "Take turns asking questions. Answer off topic or lose.",
  },
] as const;

export function definitionFor(id?: string) {
  return (
    gameDefinitions.find((game) => game.id === id) ??
    gameDefinitions.find((game) => game.id === defaultGameId)!
  );
}
