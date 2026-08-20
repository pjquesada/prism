export type ViewportBox = {
  width: number;
  height: number;
};

export type SafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const DISPLAY_VIEWPORTS = {
  mobilePortrait: { width: 390, height: 844 } satisfies ViewportBox,
  mobileLandscape: { width: 844, height: 390 } satisfies ViewportBox,
  desktop: { width: 1440, height: 900 } satisfies ViewportBox,
  tv16x9: { width: 1920, height: 1080 } satisfies ViewportBox,
} as const;

export type DisplayViewportName = keyof typeof DISPLAY_VIEWPORTS;

/**
 * Stage size after chrome and safe-area insets. The visualizer host must match this
 * exactly — no extra letterbox region and no fixed 16rem strip.
 */
export function computeDisplayStageSize(input: {
  viewport: ViewportBox;
  chromeHeight: number;
  safeArea?: Partial<SafeAreaInsets>;
}): ViewportBox {
  const inset = {
    top: input.safeArea?.top ?? 0,
    right: input.safeArea?.right ?? 0,
    bottom: input.safeArea?.bottom ?? 0,
    left: input.safeArea?.left ?? 0,
  };
  const width = Math.max(1, input.viewport.width - inset.left - inset.right);
  const height = Math.max(
    1,
    input.viewport.height - inset.top - inset.bottom - Math.max(0, input.chromeHeight),
  );
  return { width, height };
}

export function stageFillsViewport(
  stage: ViewportBox,
  viewport: ViewportBox,
  chromeHeight: number,
  tolerance = 2,
): boolean {
  const expected = computeDisplayStageSize({ viewport, chromeHeight });
  return (
    Math.abs(stage.width - expected.width) <= tolerance &&
    Math.abs(stage.height - expected.height) <= tolerance
  );
}
