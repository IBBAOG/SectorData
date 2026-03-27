declare module "plotly.js-dist-min" {
  const Plotly: {
    toImage(figure: unknown, opts: unknown): Promise<string>;
    [key: string]: unknown;
  };
  export default Plotly;
}
