#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple SVG to Android Vector Drawable converter that preserves groups and IDs
class SVGToVector {
  constructor() {
    this.indent = '  ';
  }

  getEllipsePoints(cx, cy, rx, ry, numPoints = 16) {
    const points = [];
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const x = cx + rx * Math.cos(angle);
      const y = cy + ry * Math.sin(angle);
      points.push({ x, y });
    }
    return points;
  }

  applyTransform(x, y, transform) {
    let tx = 0,
      ty = 0,
      angle = 0;
    const translateMatch = transform.match(/translate\(([^)]+)\)/);
    if (translateMatch) {
      const parts = translateMatch[1].split(/[\s,]+/).map(parseFloat);
      tx = parts[0];
      ty = parts[1] || 0;
    }
    const rotateMatch = transform.match(/rotate\(([^)]+)\)/);
    if (rotateMatch) {
      angle = parseFloat(rotateMatch[1]);
    }
    // Apply translate first
    x += tx;
    y += ty;
    // Then rotate
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const newX = x * cos - y * sin;
    const newY = x * sin + y * cos;
    return { x: newX, y: newY };
  }

  rotatePoint(x, y, cx, cy, angle) {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = x - cx;
    const dy = y - cy;
    const newDx = dx * cos - dy * sin;
    const newDy = dx * sin + dy * cos;
    return { x: cx + newDx, y: cy + newDy };
  }

  parseViewBox(viewBox) {
    const parts = viewBox.trim().split(/\s+/);
    return {
      x: parseFloat(parts[0]) || 0,
      y: parseFloat(parts[1]) || 0,
      width: parseFloat(parts[2]) || 0,
      height: parseFloat(parts[3]) || 0,
    };
  }

  parseColor(color) {
    if (!color || color === 'none') return null;
    // Convert rgb/rgba to hex
    if (color.startsWith('rgb')) {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (match) {
        const r = parseInt(match[1]).toString(16).padStart(2, '0');
        const g = parseInt(match[2]).toString(16).padStart(2, '0');
        const b = parseInt(match[3]).toString(16).padStart(2, '0');
        const a = match[4]
          ? Math.round(parseFloat(match[4]) * 255)
              .toString(16)
              .padStart(2, '0')
          : 'FF';
        return `#${a}${r}${g}${b}`.toUpperCase();
      }
    }
    // Add # if missing
    if (color.match(/^[0-9A-Fa-f]{6}$/)) return `#${color}`;
    if (color.match(/^[0-9A-Fa-f]{3}$/)) {
      // Convert 3-digit to 6-digit hex
      return `#${color[0]}${color[0]}${color[1]}${color[1]}${color[2]}${color[2]}`;
    }
    return color.startsWith('#') ? color : `#${color}`;
  }

  parseElement(node, depth = 1) {
    const nodeName = node.nodeName.toLowerCase();
    const attrs = {};
    const children = [];

    // Get all attributes
    if (node.attributes) {
      for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        attrs[attr.name] = attr.value;
      }
    }

    let result = '';
    const indentStr = this.indent.repeat(depth);

    if (nodeName === 'g') {
      // Group element
      const name = attrs.id || attrs['data-name'] || '';

      // Collect children first to check if group is empty
      let childrenXml = '';
      if (node.childNodes) {
        for (let i = 0; i < node.childNodes.length; i++) {
          const child = node.childNodes[i];
          if (child.nodeType === 1) {
            // Element node
            childrenXml += this.parseElement(child, depth + 1);
          }
        }
      }

      // Skip empty groups
      if (!childrenXml.trim()) {
        return '';
      }

      result += `${indentStr}<group`;
      if (name) {
        result += `\n${indentStr}${this.indent}android:name="${name}"`;
      }

      // Handle transform
      if (attrs.transform) {
        const transforms = this.parseTransform(attrs.transform);
        for (let [key, value] of Object.entries(transforms)) {
          result += `\n${indentStr}${this.indent}android:${key}="${value}"`;
        }
      }

      result += '>\n';
      result += childrenXml;
      result += `${indentStr}</group>\n`;
    } else if (nodeName === 'path') {
      result += `${indentStr}<path`;
      if (attrs.id) {
        result += `\n${indentStr}${this.indent}android:name="${attrs.id}"`;
      }
      if (attrs.d) {
        result += `\n${indentStr}${this.indent}android:pathData="${attrs.d}"`;
      }
      if (attrs.fill && attrs.fill !== 'none') {
        const fillColor = this.parseColor(attrs.fill);
        if (fillColor) {
          result += `\n${indentStr}${this.indent}android:fillColor="${fillColor}"`;
        }
      }
      if (attrs.stroke && attrs.stroke !== 'none') {
        const strokeColor = this.parseColor(attrs.stroke);
        if (strokeColor) {
          result += `\n${indentStr}${this.indent}android:strokeColor="${strokeColor}"`;
        }
        if (attrs['stroke-width']) {
          result += `\n${indentStr}${this.indent}android:strokeWidth="${attrs['stroke-width']}"`;
        }
      }
      if (attrs.opacity || attrs['fill-opacity']) {
        const opacity = parseFloat(attrs.opacity || attrs['fill-opacity']);
        const alpha = Math.round(opacity * 255)
          .toString(16)
          .padStart(2, '0');
        result += `\n${indentStr}${this.indent}android:fillAlpha="${opacity}"`;
      }
      result += '/>\n';
    } else if (nodeName === 'circle') {
      // Convert circle to path
      const cx = parseFloat(attrs.cx || 0);
      const cy = parseFloat(attrs.cy || 0);
      const r = parseFloat(attrs.r || 0);
      const pathData = `M${cx - r},${cy}a${r},${r} 0,1 1,${r * 2} 0a${r},${r} 0,1 1,-${r * 2} 0`;

      result += `${indentStr}<path`;
      if (attrs.id) {
        result += `\n${indentStr}${this.indent}android:name="${attrs.id}"`;
      }
      result += `\n${indentStr}${this.indent}android:pathData="${pathData}"`;
      if (attrs.fill && attrs.fill !== 'none') {
        const fillColor = this.parseColor(attrs.fill);
        if (fillColor) {
          result += `\n${indentStr}${this.indent}android:fillColor="${fillColor}"`;
        }
      }
      result += '/>\n';
    } else if (nodeName === 'polygon') {
      // Convert polygon to path
      const points = attrs.points;
      if (points) {
        const coords = points
          .trim()
          .split(/\s+|,/)
          .filter((p) => p.trim());
        if (coords.length >= 4 && coords.length % 2 === 0) {
          let pathData = `M${coords[0]},${coords[1]}`;
          for (let i = 2; i < coords.length; i += 2) {
            pathData += ` L${coords[i]},${coords[i + 1]}`;
          }
          pathData += ' Z';

          result += `${indentStr}<path`;
          if (attrs.id) {
            result += `\n${indentStr}${this.indent}android:name="${attrs.id}"`;
          }
          result += `\n${indentStr}${this.indent}android:pathData="${pathData}"`;
          if (attrs.fill && attrs.fill !== 'none') {
            const fillColor = this.parseColor(attrs.fill);
            if (fillColor) {
              result += `\n${indentStr}${this.indent}android:fillColor="${fillColor}"`;
            }
          }
          if (attrs.stroke && attrs.stroke !== 'none') {
            const strokeColor = this.parseColor(attrs.stroke);
            if (strokeColor) {
              result += `\n${indentStr}${this.indent}android:strokeColor="${strokeColor}"`;
            }
            if (attrs['stroke-width']) {
              result += `\n${indentStr}${this.indent}android:strokeWidth="${attrs['stroke-width']}"`;
            }
          }
          result += '/>\n';
        }
      }
    } else if (nodeName === 'ellipse') {
      // Convert ellipse to path
      const cx = parseFloat(attrs.cx || 0);
      const cy = parseFloat(attrs.cy || 0);
      const rx = parseFloat(attrs.rx || 0);
      const ry = parseFloat(attrs.ry || 0);
      let points = this.getEllipsePoints(cx, cy, rx, ry);
      if (attrs.transform) {
        const rotateMatch = attrs.transform.match(/rotate\(([^)]+)\)/);
        if (rotateMatch) {
          const angle = parseFloat(rotateMatch[1]);
          points = points.map((p) => this.rotatePoint(p.x, p.y, cx, cy, angle));
        }
      }
      points = points.map((p) => ({ x: parseFloat(p.x.toFixed(2)), y: parseFloat(p.y.toFixed(2)) }));
      let pathData = `M${points[0].x},${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        pathData += ` L${points[i].x},${points[i].y}`;
      }
      pathData += ' Z';

      result += `${indentStr}<path`;
      if (attrs.id) {
        result += `\n${indentStr}${this.indent}android:name="${attrs.id}"`;
      }
      result += `\n${indentStr}${this.indent}android:pathData="${pathData}"`;
      if (attrs.fill && attrs.fill !== 'none') {
        const fillColor = this.parseColor(attrs.fill);
        if (fillColor) {
          result += `\n${indentStr}${this.indent}android:fillColor="${fillColor}"`;
        }
      }
      if (attrs.stroke && attrs.stroke !== 'none') {
        const strokeColor = this.parseColor(attrs.stroke);
        if (strokeColor) {
          result += `\n${indentStr}${this.indent}android:strokeColor="${strokeColor}"`;
        }
        if (attrs['stroke-width']) {
          result += `\n${indentStr}${this.indent}android:strokeWidth="${attrs['stroke-width']}"`;
        }
      }
      if (attrs.opacity || attrs['fill-opacity']) {
        const opacity = parseFloat(attrs.opacity || attrs['fill-opacity']);
        const alpha = Math.round(opacity * 255)
          .toString(16)
          .padStart(2, '0');
        result += `\n${indentStr}${this.indent}android:fillAlpha="${opacity}"`;
      }
      result += '/>\n';
    } else if (nodeName === 'rect') {
      // Convert rect to path
      const x = parseFloat(attrs.x || 0);
      const y = parseFloat(attrs.y || 0);
      const w = parseFloat(attrs.width || 0);
      const h = parseFloat(attrs.height || 0);
      const rx = parseFloat(attrs.rx || attrs.r || 0);
      const ry = parseFloat(attrs.ry || attrs.r || 0);

      let pathData;
      if (rx > 0 || ry > 0) {
        // Rounded rectangle - use SVG arc commands
        const r = Math.min(rx, ry, w / 2, h / 2);
        pathData = `M${x + r},${y}h${w - 2 * r}a${r},${r} 0,0 1,${r},${r}v${h - 2 * r}a${r},${r} 0,0 1,-${r},${r}h${-(w - 2 * r)}a${r},${r} 0,0 1,-${r},-${r}v${-(h - 2 * r)}a${r},${r} 0,0 1,${r},-${r}Z`;
      } else {
        // Regular rectangle
        pathData = `M${x},${y}h${w}v${h}h${-w}Z`;
      }

      // If has transform, wrap in group to apply transform
      if (attrs.transform) {
        result += `${indentStr}<group`;
        if (attrs.id) {
          result += `\n${indentStr}${this.indent}android:name="${attrs.id}"`;
        }
        const transforms = this.parseTransform(attrs.transform);
        for (let [key, value] of Object.entries(transforms)) {
          result += `\n${indentStr}${this.indent}android:${key}="${value}"`;
        }
        result += '>\n';
        result += `${indentStr}${this.indent}<path\n${indentStr}${this.indent}${this.indent}android:pathData="${pathData}"`;
      } else {
        result += `${indentStr}<path`;
        if (attrs.id) {
          result += `\n${indentStr}${this.indent}android:name="${attrs.id}"`;
        }
        result += `\n${indentStr}${this.indent}android:pathData="${pathData}"`;
      }

      if (attrs.fill && attrs.fill !== 'none') {
        const fillColor = this.parseColor(attrs.fill);
        if (fillColor) {
          result += `\n${indentStr}${this.indent}android:fillColor="${fillColor}"`;
        }
      }
      result += '/>\n';

      if (attrs.transform) {
        result += `${indentStr}</group>\n`;
      }
    }

    return result;
  }

  parseTransform(transform) {
    const result = {};

    // Parse translate
    const translateMatch = transform.match(/translate\(([-\d.]+)(?:\s+|,)([-\d.]+)\)/);
    if (translateMatch) {
      result.translateX = translateMatch[1];
      result.translateY = translateMatch[2];
    }

    // Parse scale
    const scaleMatch = transform.match(/scale\(([-\d.]+)(?:\s+|,)?([-\d.]+)?\)/);
    if (scaleMatch) {
      result.scaleX = scaleMatch[1];
      result.scaleY = scaleMatch[2] || scaleMatch[1];
    }

    // Parse rotate
    const rotateMatch = transform.match(/rotate\(([-\d.]+)\)/);
    if (rotateMatch) {
      result.rotation = rotateMatch[1];
    }

    return result;
  }

  convert(svgContent) {
    const DOMParser = require('xmldom').DOMParser;
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svg = doc.documentElement;

    // Get SVG attributes
    let width = svg.getAttribute('width') || '24';
    let height = svg.getAttribute('height') || '24';

    // Ensure dp suffix
    if (!width.endsWith('dp')) width += 'dp';
    if (!height.endsWith('dp')) height += 'dp';
    const viewBox = svg.getAttribute('viewBox');

    let viewportWidth = 24;
    let viewportHeight = 24;

    if (viewBox) {
      const vb = this.parseViewBox(viewBox);
      viewportWidth = vb.width;
      viewportHeight = vb.height;
    }

    // Build Android Vector XML
    let xml = '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n';
    xml += `${this.indent}android:width="${width}"\n`;
    xml += `${this.indent}android:height="${height}"\n`;
    xml += `${this.indent}android:viewportWidth="${viewportWidth}"\n`;
    xml += `${this.indent}android:viewportHeight="${viewportHeight}">\n`;

    // Process all children
    if (svg.childNodes) {
      for (let i = 0; i < svg.childNodes.length; i++) {
        const child = svg.childNodes[i];
        if (child.nodeType === 1) {
          // Element node
          xml += this.parseElement(child, 1);
        }
      }
    }

    xml += '</vector>\n';
    return xml;
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node svg-to-vector.js <input.svg> <output.xml>');
    process.exit(1);
  }

  const inputFile = args[0];
  const outputFile = args[1];

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const svgContent = fs.readFileSync(inputFile, 'utf8');
  const converter = new SVGToVector();
  const androidXml = converter.convert(svgContent);

  fs.writeFileSync(outputFile, androidXml);
  console.log(`✓ Converted ${inputFile} → ${outputFile}`);
  console.log(`  Preserved group structure and IDs`);
}

module.exports = SVGToVector;
