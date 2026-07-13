import * as prettierPluginBabel from "prettier/plugins/babel";
import * as prettierPluginEstree from "prettier/plugins/estree";
import * as prettier from "prettier/standalone";

const plugins = [prettierPluginBabel, prettierPluginEstree];

export async function formatJson(value: unknown): Promise<string> {
  return prettier.format(JSON.stringify(value), {
    parser: "json",
    plugins,
  });
}
