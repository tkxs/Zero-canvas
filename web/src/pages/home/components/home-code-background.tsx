import { useEffect, useRef } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

const codeLines = [
    "canvas.createNode({ type: 'image' })",
    "viewport.zoom = fit(selection.bounds)",
    "connect(source.output, target.input)",
    "agent.apply({ projectId, operations })",
    "prompt.generate({ model, references })",
    "history.commit('canvas:update')",
    "assets.resolve(node.resourceId)",
    "selection.moveBy(pointer.delta)",
    "project.save({ nodes, connections })",
    "export.canvas({ format: 'zip' })",
    "node.resize({ keepAspectRatio: true })",
    "render.queue.flush()",
];

type CodeRow = {
    alpha: number;
    direction: 1 | -1;
    repeatWidth: number;
    size: number;
    speed: number;
    text: string;
    x: number;
    y: number;
};

export function HomeCodeBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const theme = useThemeStore((state) => state.theme);
    const palette = canvasThemes[theme];

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let rows: CodeRow[] = [];
        let frame = 0;
        let lastTime = 0;

        const draw = (delta = 0) => {
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            context.clearRect(0, 0, width, height);
            context.textBaseline = "top";
            context.fillStyle = palette.canvas.selectionStroke;

            rows.forEach((row) => {
                const edgeFade = Math.min(1, Math.max(0, row.y / 100), Math.max(0, (height - row.y) / 120));
                context.font = `${row.size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
                const repeats = Math.ceil(width / row.repeatWidth) + 3;

                for (let index = -1; index < repeats; index += 1) {
                    const x = row.x + index * row.repeatWidth;
                    context.globalAlpha = row.alpha * edgeFade;
                    context.fillText(row.text, x, row.y);
                    context.globalAlpha = row.alpha * edgeFade * 0.42;
                    context.fillText("{ selected: true, synced: true }", x + row.repeatWidth * 0.48, row.y);
                }

                if (!reducedMotion) row.x += row.speed * delta * row.direction;
                if (row.direction === 1 && row.x > row.repeatWidth) row.x -= row.repeatWidth;
                if (row.direction === -1 && row.x < -row.repeatWidth) row.x += row.repeatWidth;
            });
            context.globalAlpha = 1;
        };

        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
            canvas.width = Math.max(1, Math.floor(rect.width * ratio));
            canvas.height = Math.max(1, Math.floor(rect.height * ratio));
            context.setTransform(ratio, 0, 0, ratio, 0, 0);

            const gap = rect.width < 640 ? 28 : 32;
            rows = Array.from({ length: Math.max(20, Math.ceil(rect.height / gap) + 6) }, (_, index) => {
                const direction = index % 2 === 0 ? 1 : -1;
                const size = rect.width < 640 ? 10 : 11 + Math.random() * 2;
                const text = codeLines[index % codeLines.length];
                const repeatWidth = Math.max(300, text.length * size * 0.66 + 150);
                return {
                    alpha: (theme === "dark" ? 0.07 : 0.05) + Math.random() * (theme === "dark" ? 0.09 : 0.07),
                    direction,
                    repeatWidth,
                    size,
                    speed: 10 + Math.random() * 20,
                    text,
                    x: direction === 1 ? -repeatWidth + Math.random() * repeatWidth : Math.random() * repeatWidth,
                    y: -gap + index * gap + Math.random() * 7,
                };
            });
            draw();
        };

        const animate = (time: number) => {
            const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
            lastTime = time;
            draw(delta);
            frame = requestAnimationFrame(animate);
        };

        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();
        if (!reducedMotion) frame = requestAnimationFrame(animate);

        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [palette.canvas.selectionStroke, theme]);

    return (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[calc(100vh-4rem)] min-h-[620px] overflow-hidden" aria-hidden="true">
            <div
                className="absolute inset-0 opacity-45"
                style={{
                    backgroundImage: `linear-gradient(${palette.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${palette.canvas.line} 1px, transparent 1px)`,
                    backgroundSize: "44px 44px",
                    maskImage: "linear-gradient(to bottom, transparent, black 8%, black 86%, transparent)",
                }}
            />
            <canvas
                ref={canvasRef}
                className="absolute inset-0 size-full"
                style={{
                    mixBlendMode: theme === "dark" ? "screen" : "multiply",
                    maskImage: "linear-gradient(to bottom, transparent 1%, black 8%, black 86%, transparent 99%)",
                }}
            />
        </div>
    );
}
