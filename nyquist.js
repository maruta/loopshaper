// Nyquist plot drawing for loop shaping tool

// Format a number for LaTeX display with appropriate precision
function formatNumForLatex(x) {
    const absX = Math.abs(x);
    if (absX < 1e-6) return '0';
    if (absX >= 1000) {
        const exp = Math.floor(Math.log10(absX));
        const mantissa = x / Math.pow(10, exp);
        return `${mantissa.toFixed(2)} \\times 10^{${exp}}`;
    }
    if (absX >= 100) return x.toFixed(1);
    if (absX >= 10) return x.toFixed(2);
    if (absX >= 1) return x.toFixed(3);
    if (absX >= 0.01) return x.toFixed(4);
    const exp = Math.floor(Math.log10(absX));
    const mantissa = x / Math.pow(10, exp);
    return `${mantissa.toFixed(2)} \\times 10^{${exp}}`;
}

// Format s value as LaTeX string for KaTeX rendering
// pointInfo contains: { s, indentation: { poleIm, theta } } or just { s }
function formatSValueLatex(pointInfo) {
    if (!pointInfo || !pointInfo.s) return '';

    const s = pointInfo.s;
    const indent = pointInfo.indentation;

    // If this is an indentation point, show as: s = j*poleFreq + ε*exp(j*theta)
    if (indent) {
        const poleIm = indent.poleIm;
        const theta = indent.theta;

        // Format pole position
        let poleStr;
        if (Math.abs(poleIm) < 1e-9) {
            poleStr = '0';  // Origin pole
        } else {
            const sign = poleIm >= 0 ? '' : '-';
            poleStr = `${sign}j${formatNumForLatex(Math.abs(poleIm))}`;
        }

        // Format theta as fraction of pi
        const thetaOverPi = theta / Math.PI;
        let thetaStr;
        if (Math.abs(thetaOverPi) < 0.001) {
            thetaStr = '0';
        } else if (Math.abs(thetaOverPi - 1) < 0.001) {
            thetaStr = 'j\\pi';
        } else if (Math.abs(thetaOverPi + 1) < 0.001) {
            thetaStr = '-j\\pi';
        } else if (Math.abs(thetaOverPi - 0.5) < 0.001) {
            thetaStr = 'j\\frac{\\pi}{2}';
        } else if (Math.abs(thetaOverPi + 0.5) < 0.001) {
            thetaStr = '-j\\frac{\\pi}{2}';
        } else {
            // General case: show as decimal * pi
            const sign = thetaOverPi >= 0 ? '' : '-';
            thetaStr = `${sign}j${Math.abs(thetaOverPi).toFixed(2)}\\pi`;
        }

        if (Math.abs(poleIm) < 1e-9) {
            // Origin pole: s = ε exp(jθ)
            return `s = \\varepsilon \\exp(${thetaStr})`;
        } else {
            // Non-origin pole: s = j*poleFreq + ε exp(jθ)
            return `s = ${poleStr} + \\varepsilon \\exp(${thetaStr})`;
        }
    }

    // Regular point on imaginary axis: s = jω
    const re = s.re;
    const im = s.im;

    if (Math.abs(re) < 1e-8) {
        // Pure imaginary
        if (Math.abs(im) < 1e-8) {
            return 's = 0';
        }
        const sign = im >= 0 ? '' : '-';
        return `s = ${sign}j${formatNumForLatex(Math.abs(im))}`;
    }

    // General case (should be rare in normal Nyquist)
    const reStr = formatNumForLatex(re);
    if (Math.abs(im) < 1e-8) {
        return `s = ${reStr}`;
    }
    const sign = im >= 0 ? '+' : '-';
    return `s = ${reStr} ${sign} j${formatNumForLatex(Math.abs(im))}`;
}

// Animation state
let nyquistAnimationId = null;
let nyquistAnimationProgress = 0;  // Progress as fraction (0 to 1), preserved across updates
let nyquistAnimationPlaying = true;  // Whether animation is playing
let nyquistAnimationData = null;  // Store current animation data for seeking
let nyquistCurrentWrapperId = null;  // Current wrapper ID for UI updates

// Compression radius (adjustable via mouse wheel)
let nyquistCompressionRadius = 3;

// Draw Nyquist plot with z/(1+|z|/R) mapping
// Lcompiled: compiled transfer function L(s)
// imagAxisPoles: poles on imaginary axis (for indentation)
// options: { wrapperId, canvasId, animate }
function drawNyquist(Lcompiled, imagAxisPoles, options) {
    options = options || {};
    const wrapperId = options.wrapperId || 'nyquist-wrapper';
    const canvasId = options.canvasId || 'nyquist-canvas';
    const R = nyquistCompressionRadius;  // Use global compression radius
    const animate = options.animate !== false;

    let wrapper = document.getElementById(wrapperId);
    let canvas = document.getElementById(canvasId);
    if (!wrapper || !canvas) return null;

    let ctx = canvas.getContext('2d');

    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;

    if (width === 0 || height === 0) return null;

    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Calculate Nyquist data
    // Prefer shared analysis result (evaluated L(s) along the contour) to avoid duplicate evaluations.
    const analysis = options.analysis || (typeof computeNyquistAnalysis === 'function'
        ? computeNyquistAnalysis(Lcompiled, imagAxisPoles)
        : null);

    const nyquistData = calculateNyquistData(Lcompiled, imagAxisPoles, R, analysis);
    if (!nyquistData || nyquistData.points.length === 0) return null;

    // Calculate plot bounds (in compressed coordinates)
    const margin = 50;
    const plotWidth = width - 2 * margin;
    const plotHeight = height - 2 * margin;

    // The compressed mapping z/(1+|z|/R) maps everything to |z'| < R
    // So we need to show at least radius R
    const maxRadius = R * 1.1;  // Add small margin

    // Use same scale for both axes to maintain aspect ratio
    const scale = Math.min(plotWidth, plotHeight) / (2 * maxRadius);
    const centerX = width / 2;
    const centerY = height / 2;

    // Coordinate transforms (compressed space to canvas)
    const toCanvasX = (x) => centerX + x * scale;
    const toCanvasY = (y) => centerY - y * scale;  // Flip y for standard orientation

    // Draw polar grid
    drawPolarGrid(ctx, centerX, centerY, scale, maxRadius, R);

    // Draw critical point at -1
    const criticalX = toCanvasX(compressPoint(-1, 0, R).x);
    const criticalY = toCanvasY(compressPoint(-1, 0, R).y);
    drawCriticalPoint(ctx, criticalX, criticalY);

    // Draw Nyquist curve
    drawNyquistCurve(ctx, nyquistData.points, toCanvasX, toCanvasY);

    // Draw axis labels
    ctx.fillStyle = '#333333';
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Re', width - margin + 20, centerY + 4);
    ctx.fillText('Im', centerX, margin - 15);

    // Start animation if enabled
    if (animate) {
        startNyquistAnimation(canvas, ctx, nyquistData, toCanvasX, toCanvasY, centerX, centerY, scale, maxRadius, R, wrapperId);
    }

    return nyquistData;
}

// Compress a complex point using z/(1+|z|/R) mapping
function compressPoint(re, im, R) {
    const mag = Math.sqrt(re * re + im * im);
    if (mag < 1e-10) return { x: 0, y: 0 };
    const factor = 1 / (1 + mag / R);
    return { x: re * factor, y: im * factor };
}

// Calculate Nyquist curve data with pole indentation.
// If a shared Nyquist analysis result is provided, it will be used to avoid duplicate L(s) evaluations.
function calculateNyquistData(Lcompiled, imagAxisPoles, R, analysis) {
    R = R || 10;

    // If no analysis was provided, compute it (fallback).
    const nyq = analysis || (typeof computeNyquistAnalysis === 'function'
        ? computeNyquistAnalysis(Lcompiled, imagAxisPoles)
        : null);

    return calculateNyquistDataFromAnalysis(nyq, R);
}

function calculateNyquistDataFromAnalysis(nyq, R) {
    if (!nyq || !nyq.points || nyq.points.length === 0) {
        return { points: [], cumulativeLength: [], totalLength: 0, hasOriginPole: false, poleFreqs: [] };
    }

    const allPoints = [];

    for (let p of nyq.points) {
        const re = p.L.re;
        const im = p.L.im;
        const compressed = compressPoint(re, im, R);

        allPoints.push({
            x: re, y: im,
            cx: compressed.x, cy: compressed.y,
            s: p.s,
            indentation: p.indentation || null
        });
    }

    // Calculate cumulative arc length (in compressed space)
    let cumulativeLength = [0];
    for (let i = 1; i < allPoints.length; i++) {
        const dx = allPoints[i].cx - allPoints[i - 1].cx;
        const dy = allPoints[i].cy - allPoints[i - 1].cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clampedDist = dist > 5 ? 0 : dist;
        cumulativeLength.push(cumulativeLength[i - 1] + clampedDist);
    }
    const totalLength = cumulativeLength[cumulativeLength.length - 1];

    return {
        points: allPoints,
        cumulativeLength,
        totalLength,
        hasOriginPole: !!nyq.hasOriginPole,
        poleFreqs: nyq.poleFreqs || []
    };
}

// Draw polar grid with unit circle highlighted
function drawPolarGrid(ctx, centerX, centerY, scale, maxRadius, R) {
    // Draw radial lines (every 15 degrees)
    for (let deg = 0; deg < 180; deg += 15) {
        const angle = deg * Math.PI / 180;
        const dx = Math.cos(angle) * maxRadius * scale;
        const dy = Math.sin(angle) * maxRadius * scale;

        if (deg % 45 === 0) {
            ctx.strokeStyle = '#c0c0c0';
            ctx.lineWidth = 1;
        } else {
            ctx.strokeStyle = '#e8e8e8';
            ctx.lineWidth = 0.5;
        }

        ctx.beginPath();
        ctx.moveTo(centerX - dx, centerY + dy);
        ctx.lineTo(centerX + dx, centerY - dy);
        ctx.stroke();
    }

    // Draw angle labels at 45 degree intervals (on the outer edge)
    ctx.fillStyle = '#888888';
    ctx.font = '10px Consolas, monospace';
    const labelRadius = maxRadius * scale + 12;

    const angleLabels = [
        { deg: 0, label: '0°' },
        { deg: 45, label: '45°' },
        { deg: 90, label: '90°' },
        { deg: 135, label: '135°' },
        { deg: 180, label: '180°' },
        { deg: -45, label: '-45°' },
        { deg: -90, label: '-90°' },
        { deg: -135, label: '-135°' }
    ];

    for (let item of angleLabels) {
        const angle = item.deg * Math.PI / 180;
        const lx = centerX + Math.cos(angle) * labelRadius;
        const ly = centerY - Math.sin(angle) * labelRadius;

        if (Math.abs(item.deg) === 90) {
            ctx.textAlign = 'center';
            ctx.textBaseline = item.deg > 0 ? 'bottom' : 'top';
        } else if (item.deg === 0 || item.deg === 180) {
            ctx.textAlign = item.deg === 0 ? 'left' : 'right';
            ctx.textBaseline = 'middle';
        } else if (item.deg > 0) {
            ctx.textAlign = item.deg < 90 ? 'left' : 'right';
            ctx.textBaseline = 'bottom';
        } else {
            ctx.textAlign = item.deg > -90 ? 'left' : 'right';
            ctx.textBaseline = 'top';
        }

        ctx.fillText(item.label, lx, ly);
    }

    // Draw concentric circles in compressed space
    // We want to show circles at original radii: 0.5, 1, 2, 5, 10, etc.
    const originalRadii = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

    for (let r of originalRadii) {
        // Compress the radius
        const compressedR = r / (1 + r / R);
        if (compressedR > maxRadius) continue;

        const pixelRadius = compressedR * scale;

        if (Math.abs(r - 1) < 0.001) {
            // Unit circle - black dashed
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
        } else {
            ctx.strokeStyle = '#c0c0c0';
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.arc(centerX, centerY, pixelRadius, 0, 2 * Math.PI);
        ctx.stroke();

        // Draw radius label on positive real axis
        if (r >= 0.5 && r !== 1) {
            ctx.fillStyle = '#999999';
            ctx.font = '10px Consolas, monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.setLineDash([]);
            let labelX = centerX + pixelRadius + 3;
            let labelText = r >= 1 ? r.toString() : r.toFixed(1);
            ctx.fillText(labelText, labelX, centerY - 2);
        }
    }
    ctx.setLineDash([]);

    // Draw axes
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1;

    // Real axis
    ctx.beginPath();
    ctx.moveTo(centerX - maxRadius * scale, centerY);
    ctx.lineTo(centerX + maxRadius * scale, centerY);
    ctx.stroke();

    // Imaginary axis
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - maxRadius * scale);
    ctx.lineTo(centerX, centerY + maxRadius * scale);
    ctx.stroke();
}

// Draw critical point at -1
function drawCriticalPoint(ctx, x, y) {
    ctx.strokeStyle = '#dc3545';
    ctx.lineWidth = 2.5;
    const size = 8;

    // Draw X mark
    ctx.beginPath();
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.moveTo(x + size, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.stroke();

    // Label
    ctx.fillStyle = '#dc3545';
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('-1', x, y + size + 3);
}

// Draw the Nyquist curve
function drawNyquistCurve(ctx, points, toCanvasX, toCanvasY) {
    if (points.length < 2) return;

    ctx.strokeStyle = '#0088aa';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(toCanvasX(points[0].cx), toCanvasY(points[0].cy));

    for (let i = 1; i < points.length; i++) {
        // Skip if points are too far apart (discontinuity)
        let dx = points[i].cx - points[i - 1].cx;
        let dy = points[i].cy - points[i - 1].cy;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(toCanvasX(points[i].cx), toCanvasY(points[i].cy));
        } else {
            ctx.lineTo(toCanvasX(points[i].cx), toCanvasY(points[i].cy));
        }
    }
    ctx.stroke();

    // Draw arrows to indicate direction (at a few points along the curve)
    const arrowPositions = [0.1, 0.25, 0.4, 0.6, 0.75, 0.9];
    for (let pos of arrowPositions) {
        const idx = Math.floor(pos * points.length);
        if (idx > 0 && idx < points.length - 1) {
            drawArrow(ctx, points, idx, toCanvasX, toCanvasY);
        }
    }
}

// Draw arrow at a point along the curve
function drawArrow(ctx, points, idx, toCanvasX, toCanvasY) {
    const p0 = points[Math.max(0, idx - 1)];
    const p1 = points[idx];

    const dx = p1.cx - p0.cx;
    const dy = p1.cy - p0.cy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return;

    const x = toCanvasX(p1.cx);
    const y = toCanvasY(p1.cy);

    // Direction of arrow (in canvas coordinates)
    const dirX = dx / len;
    const dirY = -dy / len;  // Flip y

    const arrowSize = 6;
    const angle = Math.PI / 6;

    ctx.fillStyle = '#0088aa';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
        x - arrowSize * (dirX * Math.cos(angle) - dirY * Math.sin(angle)),
        y - arrowSize * (dirY * Math.cos(angle) + dirX * Math.sin(angle))
    );
    ctx.lineTo(
        x - arrowSize * (dirX * Math.cos(-angle) - dirY * Math.sin(-angle)),
        y - arrowSize * (dirY * Math.cos(-angle) + dirX * Math.sin(-angle))
    );
    ctx.closePath();
    ctx.fill();
}

// Find point position at a given arc length using binary search
function getPointAtArcLength(points, cumulativeLength, targetLength) {
    // Binary search to find the segment containing targetLength
    let lo = 0, hi = cumulativeLength.length - 1;
    while (lo < hi - 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumulativeLength[mid] <= targetLength) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    // Interpolate between points[lo] and points[hi]
    const segmentStart = cumulativeLength[lo];
    const segmentEnd = cumulativeLength[hi];
    const segmentLength = segmentEnd - segmentStart;

    if (segmentLength < 1e-10) {
        return {
            cx: points[lo].cx,
            cy: points[lo].cy,
            s: points[lo].s,
            indentation: points[lo].indentation
        };
    }

    const t = (targetLength - segmentStart) / segmentLength;
    const cx = points[lo].cx + t * (points[hi].cx - points[lo].cx);
    const cy = points[lo].cy + t * (points[hi].cy - points[lo].cy);

    // Interpolate s value (complex number)
    let s = null;
    if (points[lo].s && points[hi].s) {
        const sRe = points[lo].s.re + t * (points[hi].s.re - points[lo].s.re);
        const sIm = points[lo].s.im + t * (points[hi].s.im - points[lo].s.im);
        s = math.complex(sRe, sIm);
    } else if (points[lo].s) {
        s = points[lo].s;
    }

    // Interpolate indentation info (if both points have it with same pole)
    let indentation = null;
    if (points[lo].indentation && points[hi].indentation &&
        Math.abs(points[lo].indentation.poleIm - points[hi].indentation.poleIm) < 1e-6) {
        const theta = points[lo].indentation.theta + t * (points[hi].indentation.theta - points[lo].indentation.theta);
        indentation = { poleIm: points[lo].indentation.poleIm, theta: theta };
    } else if (points[lo].indentation) {
        indentation = points[lo].indentation;
    }

    return { cx, cy, s, indentation };
}

// Start animation of moving point on the curve
function startNyquistAnimation(canvas, ctx, nyquistData, toCanvasX, toCanvasY, centerX, centerY, scale, maxRadius, R, wrapperId) {
    // Stop any existing animation (preserves progress in nyquistAnimationProgress)
    stopNyquistAnimation();

    const points = nyquistData.points;
    const cumulativeLength = nyquistData.cumulativeLength;
    const totalLength = nyquistData.totalLength;

    if (points.length < 2 || totalLength < 1e-10) return;

    // Store animation data for seeking and UI updates
    nyquistAnimationData = {
        canvas, ctx, points, cumulativeLength, totalLength,
        toCanvasX, toCanvasY, centerX, centerY, scale, maxRadius, R
    };
    nyquistCurrentWrapperId = wrapperId;

    // Calculate speed to complete one cycle in approximately 3 seconds (180 frames at 60fps)
    const cycleDuration = 180;  // frames
    const speed = totalLength / cycleDuration;

    // Initialize current arc length from preserved progress (0 to 1 fraction)
    let currentArcLength = nyquistAnimationProgress * totalLength;

    // Setup UI controls
    setupNyquistAnimationControls(wrapperId);
    updatePlayButtonIcon(wrapperId, nyquistAnimationPlaying);
    updateSeekBar(wrapperId, nyquistAnimationProgress);

    function animate() {
        // Check if canvas is still valid and visible
        if (!canvas || !canvas.parentElement || canvas.width === 0 || canvas.height === 0) {
            stopNyquistAnimation();
            return;
        }

        // Check if wrapper is still in DOM and visible
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper || wrapper.clientWidth === 0 || wrapper.clientHeight === 0) {
            stopNyquistAnimation();
            return;
        }

        try {
            // Get current arc length from global progress (may have been updated by seek bar)
            currentArcLength = nyquistAnimationProgress * totalLength;

            // Render current frame
            renderNyquistFrame(canvas, ctx, points, cumulativeLength,
                toCanvasX, toCanvasY, centerX, centerY, scale, maxRadius, R, wrapperId, currentArcLength);

            // Update position based on arc length (uniform speed) only if playing
            if (nyquistAnimationPlaying) {
                currentArcLength += speed;
                if (currentArcLength >= totalLength) {
                    currentArcLength = currentArcLength - totalLength;
                }

                // Update global progress (0 to 1 fraction) for preservation across updates
                nyquistAnimationProgress = currentArcLength / totalLength;

                // Update seek bar
                updateSeekBar(wrapperId, nyquistAnimationProgress);
            }

            nyquistAnimationId = requestAnimationFrame(animate);
        } catch (e) {
            // If any error occurs, stop animation
            console.log('Nyquist animation error:', e);
            stopNyquistAnimation();
        }
    }

    animate();
}

// Render a single frame of the Nyquist animation
function renderNyquistFrame(canvas, ctx, points, cumulativeLength,
    toCanvasX, toCanvasY, centerX, centerY, scale, maxRadius, R, wrapperId, currentArcLength) {

    // Redraw the entire plot
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const width = canvas.width / devicePixelRatio;
    const height = canvas.height / devicePixelRatio;

    // Clear and redraw background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Redraw grid
    drawPolarGrid(ctx, centerX, centerY, scale, maxRadius, R);

    // Redraw critical point
    const criticalCompressed = compressPoint(-1, 0, R);
    const criticalX = toCanvasX(criticalCompressed.x);
    const criticalY = toCanvasY(criticalCompressed.y);
    drawCriticalPoint(ctx, criticalX, criticalY);

    // Redraw curve
    drawNyquistCurve(ctx, points, toCanvasX, toCanvasY);

    // Draw axis labels
    ctx.fillStyle = '#333333';
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Re', width - 30, centerY + 4);
    ctx.fillText('Im', centerX, 35);

    // Get interpolated point position at current arc length
    const p = getPointAtArcLength(points, cumulativeLength, currentArcLength);
    const px = toCanvasX(p.cx);
    const py = toCanvasY(p.cy);

    // Draw point with glow effect
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(0, 136, 170, 0.3)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#0088aa';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Display current s value using KaTeX overlay
    const sOverlayId = wrapperId === 'narrow-nyquist-wrapper' ? 'narrow-nyquist-s-value-overlay' : 'nyquist-s-value-overlay';
    const sOverlay = document.getElementById(sOverlayId);
    if (sOverlay && p.s) {
        const latexStr = formatSValueLatex({ s: p.s, indentation: p.indentation });
        if (latexStr && typeof katex !== 'undefined') {
            try {
                katex.render(latexStr, sOverlay, { throwOnError: false });
            } catch (e) {
                sOverlay.textContent = latexStr;
            }
        }
    }

    // Update Pole-Zero Map to show current s point
    if (typeof updatePolePlot === 'function' && wrapperId === 'nyquist-wrapper') {
        updatePolePlot();
    }
}

// Setup play/pause button and seek bar event handlers
function setupNyquistAnimationControls(wrapperId) {
    const isNarrow = wrapperId === 'narrow-nyquist-wrapper';
    const playBtnId = isNarrow ? 'narrow-nyquist-play-btn' : 'nyquist-play-btn';
    const seekBarId = isNarrow ? 'narrow-nyquist-seek-bar' : 'nyquist-seek-bar';

    const playBtn = document.getElementById(playBtnId);
    const seekBar = document.getElementById(seekBarId);

    if (playBtn && !playBtn._nyquistSetup) {
        playBtn._nyquistSetup = true;
        playBtn.addEventListener('click', () => {
            nyquistAnimationPlaying = !nyquistAnimationPlaying;
            updatePlayButtonIcon(wrapperId, nyquistAnimationPlaying);
        });
    }

    if (seekBar && !seekBar._nyquistSetup) {
        seekBar._nyquistSetup = true;

        // Update progress when user drags the seek bar (Shoelace sl-range uses 'sl-input' event)
        seekBar.addEventListener('sl-input', (e) => {
            const value = parseFloat(e.target.value);
            nyquistAnimationProgress = value / 1000;

            // If paused, render the current frame immediately
            if (!nyquistAnimationPlaying && nyquistAnimationData) {
                const d = nyquistAnimationData;
                const currentArcLength = nyquistAnimationProgress * d.totalLength;
                renderNyquistFrame(d.canvas, d.ctx, d.points, d.cumulativeLength,
                    d.toCanvasX, d.toCanvasY, d.centerX, d.centerY, d.scale, d.maxRadius, d.R,
                    nyquistCurrentWrapperId, currentArcLength);
            }
        });
    }
}

// Update play/pause button icon
function updatePlayButtonIcon(wrapperId, isPlaying) {
    const isNarrow = wrapperId === 'narrow-nyquist-wrapper';
    const playBtnId = isNarrow ? 'narrow-nyquist-play-btn' : 'nyquist-play-btn';
    const playBtn = document.getElementById(playBtnId);

    if (playBtn) {
        // Shoelace sl-icon-button uses 'name' attribute for icon
        playBtn.name = isPlaying ? 'pause-fill' : 'play-fill';
    }
}

// Update seek bar position
function updateSeekBar(wrapperId, progress) {
    const isNarrow = wrapperId === 'narrow-nyquist-wrapper';
    const seekBarId = isNarrow ? 'narrow-nyquist-seek-bar' : 'nyquist-seek-bar';
    const seekBar = document.getElementById(seekBarId);

    if (seekBar && document.activeElement !== seekBar) {
        seekBar.value = Math.round(progress * 1000);
    }
}

// Stop animation
function stopNyquistAnimation() {
    if (nyquistAnimationId !== null) {
        cancelAnimationFrame(nyquistAnimationId);
        nyquistAnimationId = null;
    }
}

// Toggle play/pause (can be called externally)
function toggleNyquistAnimation() {
    nyquistAnimationPlaying = !nyquistAnimationPlaying;
    if (nyquistCurrentWrapperId) {
        updatePlayButtonIcon(nyquistCurrentWrapperId, nyquistAnimationPlaying);
    }
}

// Seek to a specific position (0-1)
function seekNyquistAnimation(progress) {
    nyquistAnimationProgress = Math.max(0, Math.min(1, progress));
    if (nyquistCurrentWrapperId) {
        updateSeekBar(nyquistCurrentWrapperId, nyquistAnimationProgress);
    }
}

// Redraw Nyquist without animation (for static display)
function drawNyquistStatic(Lcompiled, imagAxisPoles, options) {
    options = options || {};
    options.animate = false;
    return drawNyquist(Lcompiled, imagAxisPoles, options);
}

// Get the current s value from Nyquist animation for Pole-Zero Map display
function getCurrentNyquistSValue() {
    if (!nyquistAnimationData) return null;

    const d = nyquistAnimationData;
    const currentArcLength = nyquistAnimationProgress * d.totalLength;
    const p = getPointAtArcLength(d.points, d.cumulativeLength, currentArcLength);

    if (p && p.s) {
        return { re: p.s.re, im: p.s.im };
    }
    return null;
}
