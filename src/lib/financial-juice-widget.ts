export interface FinancialJuiceNewsWidgetOptions {
  container: string;
  width: string;
  height: string;
  mode: "Light" | "Dark" | string;
  backColor: string;
  fontColor: string;
}

export function buildFinancialJuiceNewsWidgetSrc(options: FinancialJuiceNewsWidgetOptions) {
  const params = new URLSearchParams({
    wtype: "NEWS",
    mode: options.mode,
    container: options.container,
    width: options.width,
    height: options.height,
    backC: options.backColor,
    fontC: options.fontColor,
    affurl: "",
  });

  return `https://feed.financialjuice.com/widgets/headlines.aspx?${params.toString()}`;
}
