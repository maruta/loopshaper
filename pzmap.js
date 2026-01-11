// Pole-Zero Map drawing functionality

// ============================================================================
// Pole-Zero Map Drawing
// ============================================================================

// Unified pole-zero map drawing function
// options: { wrapperId, canvasId, showLpz, showTpz, showNyquistAnimation }
function drawPoleZeroMap(options) {
    const canvas = document.getElementById(options.canvasId);
    const wrapper = document.getElementById(options.wrapperId);

    if (!canvas || !wrapper) return;

    const ctx = canvas.getContext('2d');
    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;

    if (width === 0 || height === 0) return;

    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // T(s) closed-loop poles and zeros (from stability calculation)
    const Tpoles = window.lastPoles || [];
    const Tzeros = window.lastZeros || [];

    // L(s) open-loop poles and zeros (from analysis)
    let Lpoles = [];
    let Lzeros = [];

    const analysis = currentVars.analysis;
    if (analysis) {
        const olPZ = analysis.openLoopPolesZeros;
        Lpoles = olPZ.poles;
        Lzeros = olPZ.zeros;
    }

    // Collect all points to display based on visibility settings
    const allPoints = [];
    if (options.showLpz) {
        Lpoles.forEach(p => allPoints.push(p));
        Lzeros.forEach(z => allPoints.push(z));
    }
    if (options.showTpz) {
        Tpoles.forEach(p => allPoints.push(p));
        Tzeros.forEach(z => allPoints.push(z));
    }

    if (allPoints.length === 0) return;

    // Calculate display scale (auto or manual mode)
    let maxScale;
    if (pzmapOptions.autoScale) {
        let maxRe = 0, maxIm = 0;
        allPoints.forEach(p => {
            maxRe = Math.max(maxRe, Math.abs(p.re));
            maxIm = Math.max(maxIm, Math.abs(p.im));
        });
        maxRe = Math.max(maxRe, 1) * pzmapOptions.autoScaleMultiplier;
        maxIm = Math.max(maxIm, 1) * pzmapOptions.autoScaleMultiplier;
        maxScale = Math.max(maxRe, maxIm);
    } else {
        maxScale = pzmapOptions.scaleMax;
    }

    const margin = 40;
    const plotWidth = width - 2 * margin;
    const plotHeight = height - 2 * margin;
    const scale = Math.min(plotWidth, plotHeight) / (2 * maxScale);
    const centerX = width / 2;
    const centerY = height / 2;

    // Calculate grid step size based on panel size (ensure readable spacing)
    const minPixelSpacing = 30;
    const maxGridLines = Math.floor(Math.min(plotWidth, plotHeight) / 2 / minPixelSpacing);
    const targetSteps = Math.max(2, Math.min(6, maxGridLines));
    const rawStep = maxScale / targetSteps;

    // Round to nice step values (1, 2, 5, 10, 20, 50, ...)
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    let niceStep;
    if (normalized <= 1.5) {
        niceStep = magnitude;
    } else if (normalized <= 3.5) {
        niceStep = magnitude * 2;
    } else if (normalized <= 7.5) {
        niceStep = magnitude * 5;
    } else {
        niceStep = magnitude * 10;
    }

    // Draw circular grid
    ctx.strokeStyle = '#c0c0c0';
    ctx.lineWidth = 1;

    const maxCircleRadius = Math.ceil(maxScale / niceStep) * niceStep;
    for (let r = niceStep; r <= maxCircleRadius; r += niceStep) {
        const pixelRadius = r * scale;
        ctx.beginPath();
        ctx.arc(centerX, centerY, pixelRadius, 0, 2 * Math.PI);
        ctx.stroke();
    }

    // Draw radial lines (every 45 degrees)
    for (let angle = 0; angle < Math.PI; angle += Math.PI / 4) {
        const dx = Math.cos(angle) * maxCircleRadius * scale;
        const dy = Math.sin(angle) * maxCircleRadius * scale;
        ctx.beginPath();
        ctx.moveTo(centerX - dx, centerY + dy);
        ctx.lineTo(centerX + dx, centerY - dy);
        ctx.stroke();
    }

    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, centerY);
    ctx.lineTo(width - margin, centerY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX, margin);
    ctx.lineTo(centerX, height - margin);
    ctx.stroke();

    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(centerX, margin);
    ctx.lineTo(centerX, height - margin);
    ctx.stroke();
    ctx.setLineDash([]);

    // Axis labels
    ctx.fillStyle = '#333333';
    ctx.font = '14px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Re', width - margin + 18, centerY);
    ctx.fillText('Im', centerX, margin - 15);

    // Draw tick labels on positive real axis (skip labels if too dense)
    const labelPixelSpacing = niceStep * scale;
    const minLabelSpacing = 30;
    const labelSkip = Math.max(1, Math.ceil(minLabelSpacing / labelPixelSpacing));

    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let labelIndex = 0;
    for (let r = niceStep; r <= maxCircleRadius; r += niceStep) {
        labelIndex++;
        if (labelIndex % labelSkip !== 0) continue;

        const px = centerX + r * scale;
        if (px < width - margin - 15) {
            let label;
            if (r >= 1 && r === Math.floor(r)) {
                label = r.toFixed(0);
            } else if (r >= 0.1) {
                label = r.toPrecision(2).replace(/\.?0+$/, '');
            } else {
                label = r.toPrecision(1);
            }
            ctx.fillText(label, px, centerY + 6);
        }
    }

    const colorL = CONSTANTS.COLORS.L;  // L(s) color (same as Bode plot)
    const colorT = CONSTANTS.COLORS.T;  // T(s) color (same as Bode plot)

    function isInRange(p) {
        return Math.abs(p.re) <= maxScale && Math.abs(p.im) <= maxScale;
    }

    function drawZero(z, color) {
        const px = centerX + z.re * scale;
        const py = centerY - z.im * scale;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, 2 * Math.PI);
        ctx.stroke();
    }

    function drawPole(p, color) {
        const px = centerX + p.re * scale;
        const py = centerY - p.im * scale;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px - 5, py - 5);
        ctx.lineTo(px + 5, py + 5);
        ctx.moveTo(px + 5, py - 5);
        ctx.lineTo(px - 5, py + 5);
        ctx.stroke();
    }

    function drawOutOfRangeIndicator(p, isPole, color) {
        const mag = Math.sqrt(p.re * p.re + p.im * p.im);
        if (mag < 1e-10) return;

        const angle = Math.atan2(-p.im, p.re);
        const tipRadius = maxCircleRadius * scale;
        const tipX = centerX + tipRadius * Math.cos(angle);
        const tipY = centerY + tipRadius * Math.sin(angle);

        ctx.fillStyle = color;
        ctx.beginPath();
        const triDepth = 8, triWidth = 6;
        const baseRadius = tipRadius - triDepth;
        const baseX = centerX + baseRadius * Math.cos(angle);
        const baseY = centerY + baseRadius * Math.sin(angle);
        const perpAngle = angle + Math.PI / 2;
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX + triWidth * Math.cos(perpAngle), baseY + triWidth * Math.sin(perpAngle));
        ctx.lineTo(baseX - triWidth * Math.cos(perpAngle), baseY - triWidth * Math.sin(perpAngle));
        ctx.closePath();
        ctx.fill();

        const labelRadius = baseRadius - 10;
        const labelX = centerX + labelRadius * Math.cos(angle);
        const labelY = centerY + labelRadius * Math.sin(angle);

        ctx.font = '12px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let magStr;
        if (mag >= 100) {
            magStr = mag.toFixed(0);
        } else if (mag >= 10) {
            magStr = mag.toFixed(1);
        } else {
            magStr = mag.toPrecision(2);
        }

        const symbol = isPole ? '\u00d7' : '\u25cb';
        const label = symbol + magStr;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(labelX - textWidth / 2 - 2, labelY - 7, textWidth + 4, 14);
        ctx.fillStyle = color;
        ctx.fillText(label, labelX, labelY);
    }

    // Draw L(s) poles and zeros
    if (options.showLpz) {
        Lzeros.forEach(z => {
            if (isInRange(z)) {
                drawZero(z, colorL);
            } else {
                drawOutOfRangeIndicator(z, false, colorL);
            }
        });
        Lpoles.forEach(p => {
            if (isInRange(p)) {
                drawPole(p, colorL);
            } else {
                drawOutOfRangeIndicator(p, true, colorL);
            }
        });
    }

    // Draw T(s) poles and zeros
    if (options.showTpz) {
        Tzeros.forEach(z => {
            if (isInRange(z)) {
                drawZero(z, colorT);
            } else {
                drawOutOfRangeIndicator(z, false, colorT);
            }
        });
        Tpoles.forEach(p => {
            if (isInRange(p)) {
                drawPole(p, colorT);
            } else {
                drawOutOfRangeIndicator(p, true, colorT);
            }
        });
    }

    // Draw current s point from Nyquist animation (only for wide layout)
    if (options.showNyquistAnimation && options.showLpz && nyquistAnimationData && nyquistAnimationPlaying && isPanelVisible('nyquist')) {
        const currentS = getCurrentNyquistSValue();
        if (currentS) {
            if (currentS.indentation) {
                const indent = currentS.indentation;
                const polePx = centerX;
                const polePy = centerY - indent.poleIm * scale;
                const circleRadius = 12;
                ctx.strokeStyle = CONSTANTS.COLORS.NYQUIST_MARKER;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(polePx, polePy, circleRadius, Math.PI / 2, -Math.PI / 2, true);
                ctx.stroke();
                const markerX = polePx + circleRadius * Math.cos(indent.theta);
                const markerY = polePy - circleRadius * Math.sin(indent.theta);
                ctx.fillStyle = CONSTANTS.COLORS.NYQUIST_MARKER;
                ctx.beginPath();
                ctx.arc(markerX, markerY, 4, 0, 2 * Math.PI);
                ctx.fill();
            } else {
                const px = centerX + currentS.re * scale;
                const py = centerY - currentS.im * scale;
                ctx.fillStyle = CONSTANTS.COLORS.NYQUIST_MARKER;
                ctx.strokeStyle = CONSTANTS.COLORS.BACKGROUND;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(px, py, 7, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
            }
        }
    }
}

// ============================================================================
// Pole Plot Update
// ============================================================================

function updatePolePlot() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const showLpz = isNarrowLayout
        ? (document.getElementById('narrow-chk-show-L-pz')?.checked ?? true)
        : displayOptions.showLpz;
    const showTpz = isNarrowLayout
        ? (document.getElementById('narrow-chk-show-T-pz')?.checked ?? true)
        : displayOptions.showTpz;

    drawPoleZeroMap({
        wrapperId: prefix + 'pole-wrapper',
        canvasId: prefix + 'pole-canvas',
        showLpz: showLpz,
        showTpz: showTpz,
        showNyquistAnimation: !isNarrowLayout
    });
}
