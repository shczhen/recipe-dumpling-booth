export function wantsToLeave(text: string) {
  const line = text.normalize("NFKC").trim();
  return (
    /^(?:(?:老板娘|好|好的|行|那|算了)[,，\s]*)*(?:我不想玩了|我不玩了|不玩了|不聊了|我先走了|我得走了|我要走了|我想结束了|结束吧|结束这局|到此为止吧|先到这(?:儿|里)吧)(?:[,，\s]*(?:谢谢|再见|拜拜))*[。.!！\s]*$/u.test(
      line,
    ) ||
    /^(?:(?:ok(?:ay)?|well)[,\s]*)?(?:I (?:have to go|need to leave|want to stop|don't want to play anymore)|let's stop|please stop|stop(?: the game| please)?|end the game|goodbye|bye)(?:[,\s]*(?:thanks|thank you|bye))*[.!\s]*$/i.test(
      line,
    )
  );
}
