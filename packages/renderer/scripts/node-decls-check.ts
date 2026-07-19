/**
 * Strict Node-only declaration smoke test.
 * Run after `pnpm build` via `pnpm typecheck:node-decls`.
 */
import type {
  CanvasLike,
  CreateRendererOptions,
  ImageSource,
  MeasureOptions,
  RenderBackground,
  RenderOptions,
  Renderer,
  TiledPngOptions,
} from "fpsr";
import type { AssetSource } from "fpsr";
import type { localAssets } from "fpsr/node";
import type { planDrawList, planDrawListWithOptions, resolve } from "fpsr/planner";
import type { executeDrawList } from "fpsr/canvas";
import type { FrameId, RenderDb } from "fpsr/render-db";

type Assert<T extends true> = T;
type DoesNotHaveKey<T, K extends PropertyKey> = K extends keyof T ? false : true;

type _AssertImageSource = Assert<ImageSource extends object ? true : false>;
type _AssertFrameIdIsNumber = Assert<FrameId extends number ? true : false>;
type _AssertNoPreparedOnPublicRender = Assert<DoesNotHaveKey<RenderOptions, "preparedDrawList">>;
type _AssertNoTileFrameOnPublicRender = Assert<DoesNotHaveKey<RenderOptions, "tileFrame">>;
type _AssertNoPreparedMethod = Assert<DoesNotHaveKey<Renderer, "renderPreparedViewport">>;
type _AssertNoProfileOnTiled = Assert<DoesNotHaveKey<TiledPngOptions, "profile">>;
type _AssertMeasureLayoutOnly = Assert<DoesNotHaveKey<MeasureOptions, "background">>;
type PlanOptsArg = NonNullable<Parameters<typeof planDrawListWithOptions>[2]>;
type _AssertNoProfileOutOnPlanner = Assert<DoesNotHaveKey<PlanOptsArg, "profileOut">>;
type _AssertBackground = RenderBackground;
type _AssertRenderer = Renderer;
type _AssertCanvas = CanvasLike;
type _AssertCreate = CreateRendererOptions;
type _AssertAssets = AssetSource;
type _AssertLocal = typeof localAssets;
type _AssertPlan = typeof planDrawList;
type _AssertResolve = typeof resolve;
type _AssertExecute = typeof executeDrawList;
type _AssertDb = RenderDb;

const _ok: [
  _AssertImageSource,
  _AssertFrameIdIsNumber,
  _AssertNoPreparedOnPublicRender,
  _AssertNoTileFrameOnPublicRender,
  _AssertNoPreparedMethod,
  _AssertNoProfileOnTiled,
  _AssertMeasureLayoutOnly,
  _AssertNoProfileOutOnPlanner,
  _AssertBackground,
  _AssertRenderer,
  _AssertCanvas,
  _AssertCreate,
  _AssertAssets,
  _AssertLocal,
  _AssertPlan,
  _AssertResolve,
  _AssertExecute,
  _AssertDb,
] = [] as never;
void _ok;
