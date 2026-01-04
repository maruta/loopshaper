# LoopShaper

A web-based loop shaping control design tool for analyzing and designing feedback control systems.

## Features

- **Interactive Bode Plot**: Visualize gain and phase response of open-loop transfer function L(s) and closed-loop transfer function T(s)
- **Real-time Parameter Tuning**: Adjust controller parameters using sliders with instant plot updates
- **Stability Analysis**: Automatic calculation of gain margin, phase margin, and closed-loop poles
- **Pole-Zero Map**: Visual representation of closed-loop pole locations
- **URL State Persistence**: Share designs via URL - all settings are compressed and encoded in the URL hash
- **Responsive Layout**: Resizable panels with collapsible sections

## Usage

1. Open `[index.html](https://maruta.github.io/loopshaper/)` in a web browser
2. Enter your transfer function definition in the **System Definition** field using JavaScript/math.js syntax
3. Add parameter sliders to interactively tune your controller
4. View the Bode plot, stability margins, and pole-zero map in real-time

### Transfer Function Syntax

Define your system using math.js expressions. The variable `s` represents the Laplace variable.

Example:
```javascript
P = 1 / (s * (s + 1))
C = K * (1 + 1 / (Ti * s))
L = P * C
```

### Parameters

Add sliders to control parameters in your transfer function:
- **Name**: Variable name used in equations
- **Min/Max**: Slider range
- **Log**: Enable logarithmic scaling

## Demo

Try the default example: a simple PI controller design for a first-order system with integrator.

## Technologies

- [Bootstrap 5](https://getbootstrap.com/) - UI framework
- [KaTeX](https://katex.org/) - LaTeX math rendering
- [math.js](https://mathjs.org/) - Mathematical expression parsing and complex number operations
- [pako](https://github.com/nodeca/pako) - zlib compression for URL encoding

## License

MIT License - see [LICENSE](LICENSE) file for details.
