'use client';

import { LineChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

// Register only what the dashboard uses to keep the bundle small.
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  AriaComponent,
  CanvasRenderer,
]);

export type EChartOption = echarts.EChartsCoreOption;

export function EChart({
  option,
  height,
  label,
}: {
  option: EChartOption;
  height: number;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = echarts.init(element);
    chart.current = instance;

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    // Live data replaces the series wholesale; animation is off to keep updates cheap.
    chart.current?.setOption({ animation: false, ...option }, { notMerge: true });
  }, [option]);

  return (
    <div ref={container} role="img" aria-label={label} style={{ height }} className="w-full" />
  );
}
