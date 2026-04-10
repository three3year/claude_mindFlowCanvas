const canvas = document.getElementById('canvas');
const canvasInner = document.getElementById('canvas-inner');
const svg = document.getElementById('connections');
const contextMenu = document.getElementById('context-menu');

/* ---- Zoom & Pan ---- */
let scale = 1;
let panX = 0, panY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };

const gridCanvas = document.getElementById('grid-canvas');
const gridCtx = gridCanvas.getContext('2d');

function resizeGridCanvas() {
  gridCanvas.width = canvas.clientWidth;
  gridCanvas.height = canvas.clientHeight;
  drawGrid();
}
window.addEventListener('resize', resizeGridCanvas);

function applyTransform() {
  canvasInner.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  drawGrid();
}

function panToNode(node) {
  const nx = parseInt(node.style.left) + node.offsetWidth / 2;
  const ny = parseInt(node.style.top) + node.offsetHeight / 2;
  panX = canvas.clientWidth / 2 - nx * scale;
  panY = canvas.clientHeight / 2 - ny * scale;
  applyTransform();
  refreshConnections();
  node.classList.add('selected');
  setTimeout(() => node.classList.remove('selected'), 800);
}

function drawGrid() {
  const w = gridCanvas.width;
  const h = gridCanvas.height;
  gridCtx.clearRect(0, 0, w, h);

  const smallGrid = 20;
  const bigGrid = 100;

  // small dots
  const step = smallGrid * scale;
  if (step > 6) {
    const offX = panX % step;
    const offY = panY % step;
    gridCtx.fillStyle = '#334155';
    for (let x = offX; x < w; x += step) {
      for (let y = offY; y < h; y += step) {
        gridCtx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
  }

  // big grid lines
  const bigStep = bigGrid * scale;
  const bigOffX = panX % bigStep;
  const bigOffY = panY % bigStep;
  gridCtx.strokeStyle = '#1E293B';
  gridCtx.lineWidth = 1;
  gridCtx.beginPath();
  for (let x = bigOffX; x < w; x += bigStep) {
    const rx = Math.round(x) + 0.5;
    gridCtx.moveTo(rx, 0);
    gridCtx.lineTo(rx, h);
  }
  for (let y = bigOffY; y < h; y += bigStep) {
    const ry = Math.round(y) + 0.5;
    gridCtx.moveTo(0, ry);
    gridCtx.lineTo(w, ry);
  }
  gridCtx.stroke();

  // axis lines (origin)
  gridCtx.strokeStyle = '#475569';
  gridCtx.lineWidth = 1.5;
  gridCtx.beginPath();
  const originX = Math.round(panX) + 0.5;
  if (originX >= 0 && originX <= w) {
    gridCtx.moveTo(originX, 0);
    gridCtx.lineTo(originX, h);
  }
  const originY = Math.round(panY) + 0.5;
  if (originY >= 0 && originY <= h) {
    gridCtx.moveTo(0, originY);
    gridCtx.lineTo(w, originY);
  }
  gridCtx.stroke();

  // coordinate labels on big grid
  gridCtx.fillStyle = '#475569';
  gridCtx.font = '10px "Fira Code", monospace';
  gridCtx.textBaseline = 'top';
  for (let x = bigOffX; x < w; x += bigStep) {
    const coord = Math.round((x - panX) / scale);
    gridCtx.fillText(coord, x + 3, 3);
  }
  gridCtx.textBaseline = 'alphabetic';
  for (let y = bigOffY; y < h; y += bigStep) {
    const coord = Math.round((y - panY) / scale);
    gridCtx.fillText(coord, 3, y - 3);
  }
}

setTimeout(() => {
  resizeGridCanvas();
  panX = canvas.clientWidth / 2;
  panY = canvas.clientHeight / 2;
  applyTransform();
}, 0);

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const oldScale = scale;
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  scale = Math.min(3, Math.max(0.1, scale * delta));

  panX = mx - (mx - panX) * (scale / oldScale);
  panY = my - (my - panY) * (scale / oldScale);
  applyTransform();
  refreshConnections();
}, { passive: false });

// middle mouse pan & space+drag pan
let _spaceDown = false;
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !_spaceDown) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    if (document.activeElement) document.activeElement.blur();
    _spaceDown = true;
    canvas.style.cursor = 'grab';
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    _spaceDown = false;
    if (!isPanning) canvas.style.cursor = '';
  }
});

canvas.addEventListener('mousedown', e => {
  if (e.button === 1 || (_spaceDown && e.button === 0)) {
    e.preventDefault();
    isPanning = true;
    panStart = { x: e.clientX - panX, y: e.clientY - panY };
    canvas.style.cursor = 'grabbing';
  }
});
document.addEventListener('mousemove', e => {
  if (isPanning) {
    panX = e.clientX - panStart.x;
    panY = e.clientY - panStart.y;
    applyTransform();
    refreshConnections();
  }
});
document.addEventListener('mouseup', e => {
  if (isPanning && (e.button === 1 || e.button === 0)) {
    isPanning = false;
    canvas.style.cursor = _spaceDown ? 'grab' : '';
  }
});

function getViewCenter() {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  return {
    x: (cw / 2 - panX) / scale,
    y: (ch / 2 - panY) / scale
  };
}

let nodeCount = 0;
let portIdCounter = 0;
let connections = [];
let draggingNode = null;
let dragOffset = { x: 0, y: 0 };
let wireDrag = null;
let contextTarget = null;
let nodeConfigs = {};
let selectedNodes = new Set();
let boxSelect = null;
const selectBox = document.getElementById('select-box');

/* ---- Node Name Validation ---- */
function getNodeType(node) {
  return node.dataset.category || '';
}

function isNodeNameTaken(name, nodeType, excludeNodeId) {
  const allNodes = canvasInner.querySelectorAll('.node');
  for (const n of allNodes) {
    if (n.id === excludeNodeId) continue;
    if (getNodeType(n) !== nodeType) continue;
    const title = n.querySelector('.header-title');
    if (title && title.textContent === name) return true;
  }
  return false;
}

/* ---- Inline Editing ---- */
function makeEditable(el, defaultText) {
  el.dataset.defaultText = defaultText;
  el.addEventListener('dblclick', e => {
    e.stopPropagation();
    const old = el.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = old;
    input.style.cssText = `
      width: ${Math.max(el.offsetWidth, 40)}px; font: inherit; color: #F8FAFC;
      background: #0F172A; border: 1px solid #22C55E; border-radius: 4px;
      padding: 0 2px; outline: none; text-align: inherit;
    `;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const val = input.value.trim() || el.dataset.defaultText;
      const node = el.closest('.node');
      if (node && el.classList.contains('header-title')) {
        const nodeType = getNodeType(node);
        if (val !== old && isNodeNameTaken(val, nodeType, node.id)) {
          input.style.borderColor = '#EF4444';
          input.title = '同類別已有相同名稱';
          input.focus();
          return;
        }
      }
      el.textContent = val;
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') input.blur();
      if (ev.key === 'Escape') { input.value = old; input.blur(); }
    });
  });
}

function makeEditable_noCheck(el, defaultText) {
  el.dataset.defaultText = defaultText;
  el.addEventListener('dblclick', e => {
    e.stopPropagation();
    const old = el.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = old;
    input.style.cssText = `
      width: ${Math.max(el.offsetWidth, 40)}px; font: inherit; color: #F8FAFC;
      background: #0F172A; border: 1px solid #22C55E; border-radius: 4px;
      padding: 0 2px; outline: none; text-align: inherit;
    `;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const val = input.value.trim() || el.dataset.defaultText;
      el.textContent = val;
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') input.blur();
      if (ev.key === 'Escape') { input.value = old; input.blur(); }
    });
  });
}

/* ---- Create Node (core) ---- */
function createNode(title, inputs, outputs, opts) {
  opts = opts || {};
  nodeCount++;
  const id = 'node-' + nodeCount;
  const node = document.createElement('div');
  node.className = 'node';
  node.id = id;
  node.dataset.category = opts.category || 'styleBlue';
  const vc = getViewCenter();
  node.style.left = (opts.x != null ? opts.x : vc.x - 100 + (nodeCount % 5) * 30) + 'px';
  node.style.top = (opts.y != null ? opts.y : vc.y - 50 + (nodeCount % 5) * 30) + 'px';

  node.innerHTML = `
    <div class="node-header"><span class="header-title">${title}</span></div>
    <div class="node-desc"><textarea placeholder="主要功能描述..."></textarea></div>
    <div class="node-body"></div>`;

  canvasInner.appendChild(node);
  setupNodeDrag(node);
  setupNodeContextMenu(node);

  makeEditable(node.querySelector('.header-title'), title);

  const textarea = node.querySelector('.node-desc textarea');
  new ResizeObserver(() => refreshConnections()).observe(textarea);

  initPortButtons(node, id);

  if (opts.ports) {
    opts.ports.forEach(p => addPort(node, id, p.label, p.mode));
  } else {
    const maxLen = Math.max(inputs.length, outputs.length);
    for (let i = 0; i < maxLen; i++) {
      const label = inputs[i] || outputs[i] || `Port ${i + 1}`;
      const hasLeft = i < inputs.length;
      const hasRight = i < outputs.length;
      const mode = hasLeft && hasRight ? 'both' : hasLeft ? 'left' : 'right';
      addPort(node, id, label, mode);
    }
  }

  if (opts.desc) {
    node.querySelector('.node-desc textarea').value = opts.desc;
  }

  return node;
}

/* ---- Add Blank Node ---- */
function addBlankNode(category) {
  const cat = category || 'styleBlue';
  const node = createNode(`節點 ${nodeCount + 1}`, [], [], { category: cat, ports: [{ label: 'Port 1', mode: 'both' }] });
  return node;
}

/* ---- Add / Remove Ports ---- */
function addPort(node, nodeId, labelText, mode) {
  mode = mode || 'both';
  const body = node.querySelector('.node-body');
  const count = body.querySelectorAll('.port-row').length + 1;
  const text = labelText || `Port ${count}`;

  portIdCounter++;
  const inputPortId = 'port-' + portIdCounter;
  portIdCounter++;
  const outputPortId = 'port-' + portIdCounter;

  const row = document.createElement('div');
  row.className = 'port-row';
  row.dataset.mode = mode;

  const leftDot = document.createElement('div');
  leftDot.className = 'port input';
  leftDot.dataset.node = nodeId;
  leftDot.dataset.portId = inputPortId;
  leftDot.dataset.type = 'input';
  if (mode === 'right' || mode === 'none') leftDot.classList.add('hidden-port');

  const label = document.createElement('span');
  label.className = 'port-label';
  label.textContent = text;
  makeEditable_noCheck(label, text);

  const rightDot = document.createElement('div');
  rightDot.className = 'port output';
  rightDot.dataset.node = nodeId;
  rightDot.dataset.portId = outputPortId;
  rightDot.dataset.type = 'output';
  if (mode === 'left' || mode === 'none') rightDot.classList.add('hidden-port');

  const delBtn = document.createElement('button');
  delBtn.className = 'port-delete';
  delBtn.textContent = '\u2715';
  delBtn.title = '刪除此行';
  delBtn.addEventListener('mousedown', e => e.stopPropagation());
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    removeConnectionsForRow(row);
    row.remove();
    refreshConnections();
  });

  row.appendChild(leftDot);
  row.appendChild(label);
  row.appendChild(rightDot);
  row.appendChild(delBtn);

  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showPortContextMenu(e, row);
  });

  const btns = body.querySelector('.port-btns');
  body.insertBefore(row, btns);
  setupPortEvents(leftDot, nodeId, inputPortId);
  setupPortEvents(rightDot, nodeId, outputPortId);
  refreshConnections();
}

function removeConnectionsForRow(row) {
  const ports = row.querySelectorAll('.port');
  ports.forEach(portEl => {
    const toRemove = connections.filter(c => c.from.el === portEl || c.to.el === portEl);
    toRemove.forEach(c => c.line.remove());
    connections = connections.filter(c => c.from.el !== portEl && c.to.el !== portEl);
  });
}

function removeConnectionsForPort(portEl) {
  const toRemove = connections.filter(c => c.from.el === portEl || c.to.el === portEl);
  toRemove.forEach(c => c.line.remove());
  connections = connections.filter(c => c.from.el !== portEl && c.to.el !== portEl);
  refreshConnections();
}

function initPortButtons(node, nodeId) {
  const body = node.querySelector('.node-body');
  const btns = document.createElement('div');
  btns.className = 'port-btns';

  const addBtn = document.createElement('button');
  addBtn.className = 'port-btn add';
  addBtn.textContent = '+';
  addBtn.title = '新增一行';

  btns.appendChild(addBtn);
  body.appendChild(btns);

  addBtn.addEventListener('mousedown', e => e.stopPropagation());
  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    addPort(node, nodeId);
  });
}

/* ---- Hide All Context Menus ---- */
function hideAllContextMenus() {
  contextMenu.style.display = 'none';
  canvasContextMenu.style.display = 'none';
  portContextMenu.style.display = 'none';
  contextTarget = null;
  _portCtxRow = null;
}

/* ---- Port Context Menu ---- */
const portContextMenu = document.getElementById('port-context-menu');
let _portCtxRow = null;

function showPortContextMenu(e, row) {
  hideAllContextMenus();
  _portCtxRow = row;
  const mode = row.dataset.mode || 'both';
  portContextMenu.querySelectorAll('.port-mode-item').forEach(item => {
    item.classList.toggle('active', item.dataset.mode === mode);
  });
  portContextMenu.style.left = e.clientX + 'px';
  portContextMenu.style.top = e.clientY + 'px';
  portContextMenu.style.display = 'block';
}

portContextMenu.querySelectorAll('.port-mode-item').forEach(item => {
  item.addEventListener('click', () => {
    if (!_portCtxRow) return;
    const newMode = item.dataset.mode;
    _portCtxRow.dataset.mode = newMode;
    const leftDot = _portCtxRow.querySelector('.port.input');
    const rightDot = _portCtxRow.querySelector('.port.output');
    if (newMode === 'right' || newMode === 'none') {
      removeConnectionsForPort(leftDot);
      leftDot.classList.add('hidden-port');
    } else {
      leftDot.classList.remove('hidden-port');
    }
    if (newMode === 'left' || newMode === 'none') {
      removeConnectionsForPort(rightDot);
      rightDot.classList.add('hidden-port');
    } else {
      rightDot.classList.remove('hidden-port');
    }
    refreshConnections();
    portContextMenu.style.display = 'none';
    _portCtxRow = null;
  });
});

document.getElementById('port-ctx-delete').addEventListener('click', () => {
  if (!_portCtxRow) return;
  removeConnectionsForRow(_portCtxRow);
  _portCtxRow.remove();
  refreshConnections();
  portContextMenu.style.display = 'none';
  _portCtxRow = null;
});

/* ---- Node Dragging (supports group) ---- */
let groupDragOffsets = [];

function setupNodeDrag(node) {
  const header = node.querySelector('.node-header');
  header.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();

    if (e.ctrlKey) {
      if (selectedNodes.has(node)) {
        selectedNodes.delete(node);
        node.classList.remove('selected');
        return;
      } else {
        selectedNodes.add(node);
        node.classList.add('selected');
      }
    } else if (!selectedNodes.has(node)) {
      clearSelection();
      selectedNodes.add(node);
      node.classList.add('selected');
    }

    draggingNode = node;

    groupDragOffsets = [...selectedNodes].map(n => ({
      node: n,
      ox: e.clientX / scale - (parseInt(n.style.left) || 0),
      oy: e.clientY / scale - (parseInt(n.style.top) || 0)
    }));
  });
}

/* ---- Box Selection ---- */
let _lastCanvasClick = null;
let _pasteCount = 0;

canvas.addEventListener('mousedown', e => {
  if (e.target !== canvas && e.target !== canvasInner && e.target !== selectBox) return;
  if (e.button !== 0) return;
  clearSelection();
  const canvasRect = canvas.getBoundingClientRect();
  const sx = (e.clientX - canvasRect.left - panX) / scale;
  const sy = (e.clientY - canvasRect.top - panY) / scale;
  _lastCanvasClick = { x: sx, y: sy };
  _pasteCount = 0;
  boxSelect = { startX: sx, startY: sy };
  selectBox.style.left = sx + 'px';
  selectBox.style.top = sy + 'px';
  selectBox.style.width = '0px';
  selectBox.style.height = '0px';
  selectBox.style.display = 'block';
});

document.addEventListener('mousemove', e => {
  // group drag
  if (draggingNode && groupDragOffsets.length > 0) {
    if (!draggingNode._didDrag) { pushUndo(); draggingNode._didDrag = true; }
    groupDragOffsets.forEach(g => {
      let x = e.clientX / scale - g.ox;
      let y = e.clientY / scale - g.oy;
      if (e.shiftKey) {
        const GRID = 20;
        x = Math.round(x / GRID) * GRID;
        y = Math.round(y / GRID) * GRID;
      }
      g.node.style.left = x + 'px';
      g.node.style.top = y + 'px';
    });
    refreshConnections();
  }
  // box select
  if (boxSelect) {
    const canvasRect = canvas.getBoundingClientRect();
    const cx = (e.clientX - canvasRect.left - panX) / scale;
    const cy = (e.clientY - canvasRect.top - panY) / scale;
    const x = Math.min(boxSelect.startX, cx);
    const y = Math.min(boxSelect.startY, cy);
    const w = Math.abs(cx - boxSelect.startX);
    const h = Math.abs(cy - boxSelect.startY);
    selectBox.style.left = x + 'px';
    selectBox.style.top = y + 'px';
    selectBox.style.width = w + 'px';
    selectBox.style.height = h + 'px';

    canvasInner.querySelectorAll('.node').forEach(node => {
      if (node.classList.contains('dimmed')) return;
      const nx = parseInt(node.style.left) || 0;
      const ny = parseInt(node.style.top) || 0;
      const nw = node.offsetWidth;
      const nh = node.offsetHeight;
      const overlap = nx + nw > x && nx < x + w && ny + nh > y && ny < y + h;
      node.classList.toggle('selected', overlap);
    });
  }
  if (wireDrag) {
    updateTempLine(e);
  }
});

document.addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  if (boxSelect) {
    const bx = parseInt(selectBox.style.left);
    const by = parseInt(selectBox.style.top);
    const bw = parseInt(selectBox.style.width);
    const bh = parseInt(selectBox.style.height);
    selectBox.style.display = 'none';

    canvasInner.querySelectorAll('.node').forEach(node => {
      if (node.classList.contains('dimmed')) return;
      const nx = parseInt(node.style.left) || 0;
      const ny = parseInt(node.style.top) || 0;
      const nw = node.offsetWidth;
      const nh = node.offsetHeight;
      if (nx + nw > bx && nx < bx + bw && ny + nh > by && ny < by + bh) {
        selectedNodes.add(node);
        node.classList.add('selected');
      }
    });
    boxSelect = null;
  }

  if (draggingNode) draggingNode._didDrag = false;
  draggingNode = null;
  groupDragOffsets = [];
  if (wireDrag) {
    if (wireDrag.tempLine) wireDrag.tempLine.remove();
    wireDrag = null;
    document.body.classList.remove('wiring');
  }
});

function clearSelection() {
  selectedNodes.forEach(n => n.classList.remove('selected'));
  selectedNodes.clear();
}

/* ---- Port Events ---- */
function setupPortEvents(portEl, nodeId, portId) {
  const type = portEl.dataset.type;

  if (type === 'output') {
    portEl.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const tempLine = createSVGLine(true);
      const srcNode = document.getElementById(nodeId);
      tempLine.setAttribute('stroke', getNodeColor(srcNode));
      svg.appendChild(tempLine);
      wireDrag = { fromPort: portEl, fromNodeId: nodeId, fromPortId: portId, tempLine };
      document.body.classList.add('wiring');
      updateTempLine(e);
    });

    portEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      pushUndo();
      removeConnectionsForPort(portEl);
    });
  }

  if (type === 'input') {
    portEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      pushUndo();
      removeConnectionsForPort(portEl);
    });

    portEl.addEventListener('mouseup', e => {
      e.stopPropagation();
      if (!wireDrag) return;
      if (wireDrag.fromNodeId === nodeId) return;

      const exists = connections.some(c =>
        c.from.portId === wireDrag.fromPortId && c.to.portId === portId);
      if (exists) return;

      pushUndo();
      const line = createSVGLine(false);
      const fromNodeEl = document.getElementById(wireDrag.fromNodeId);
      line.setAttribute('stroke', getNodeColor(fromNodeEl));
      svg.appendChild(line);
      connections.push({
        from: { nodeId: wireDrag.fromNodeId, portId: wireDrag.fromPortId, el: wireDrag.fromPort },
        to:   { nodeId: nodeId, portId: portId, el: portEl },
        line
      });
      refreshConnections();

      if (wireDrag.tempLine) wireDrag.tempLine.remove();
      wireDrag = null;
      document.body.classList.remove('wiring');
    });
  }
}

function getNodeColor(nodeEl) {
  const cat = getNodeCategory(nodeEl);
  return (nodeConfigs[cat] && nodeConfigs[cat].color) || '#22C55E';
}

function getNodeCategory(node) {
  return node.dataset.category || '';
}

function createSVGLine(temp) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (temp) path.classList.add('temp');
  return path;
}

function buildCurvePath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const offset = Math.max(50, dx * 0.4);
  return `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
}

function getPortCenter(portEl) {
  const rect = portEl.getBoundingClientRect();
  const innerRect = canvasInner.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return {
      x: (rect.left - innerRect.left + rect.width / 2) / scale,
      y: (rect.top - innerRect.top + rect.height / 2) / scale
    };
  }
  const nodeId = portEl.dataset.node;
  const nodeEl = nodeId ? document.getElementById(nodeId) : null;
  if (nodeEl) {
    const nodeRect = nodeEl.getBoundingClientRect();
    return {
      x: (nodeRect.right - innerRect.left) / scale,
      y: (nodeRect.top - innerRect.top + nodeRect.height / 2) / scale
    };
  }
  return { x: 0, y: 0 };
}

function updateTempLine(e) {
  if (!wireDrag || !wireDrag.tempLine) return;
  const from = getPortCenter(wireDrag.fromPort);
  const innerRect = canvasInner.getBoundingClientRect();
  const toX = (e.clientX - innerRect.left) / scale;
  const toY = (e.clientY - innerRect.top) / scale;
  wireDrag.tempLine.setAttribute('d', buildCurvePath(from.x, from.y, toX, toY));
}

/* ---- Context Menu ---- */
function setupNodeContextMenu(node) {
  node.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    hideAllContextMenus();
    if (!selectedNodes.has(node)) {
      selectedNodes.forEach(n => n.classList.remove('selected'));
      selectedNodes.clear();
      selectedNodes.add(node);
      node.classList.add('selected');
    }
    contextTarget = node;
    contextMenu.style.display = 'block';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
  });
}

document.addEventListener('click', () => {
  hideAllContextMenus();
});

/* ---- Canvas Right-Click Menu ---- */
const canvasContextMenu = document.getElementById('canvas-context-menu');
let canvasContextPos = { x: 0, y: 0 };

canvas.addEventListener('contextmenu', e => {
  if (e.target !== canvas && e.target !== canvasInner && e.target.id !== 'grid-canvas') return;
  e.preventDefault();
  hideAllContextMenus();
  selectedNodes.forEach(n => n.classList.remove('selected'));
  selectedNodes.clear();

  const canvasRect = canvas.getBoundingClientRect();
  canvasContextPos = {
    x: (e.clientX - canvasRect.left - panX) / scale,
    y: (e.clientY - canvasRect.top - panY) / scale
  };

  canvasContextMenu.style.display = 'block';
  canvasContextMenu.style.left = e.clientX + 'px';
  canvasContextMenu.style.top = e.clientY + 'px';
});

document.getElementById('ctx-add-node').addEventListener('click', e => e.stopPropagation());

document.querySelectorAll('#canvas-context-menu [data-add-cat]').forEach(item => {
  item.addEventListener('click', () => {
    pushUndo();
    const node = addBlankNode(item.dataset.addCat);
    if (node) {
      node.style.left = canvasContextPos.x + 'px';
      node.style.top = canvasContextPos.y + 'px';
    }
    canvasContextMenu.style.display = 'none';
    refreshConnections();
  });
});

const addNodeDropdown = document.getElementById('add-node-dropdown');
document.getElementById('add-node-btn').addEventListener('click', e => {
  e.stopPropagation();
  addNodeDropdown.classList.toggle('open');
});
document.querySelectorAll('#add-node-menu .menu-item').forEach(item => {
  item.addEventListener('click', () => {
    pushUndo();
    addBlankNode(item.dataset.cat);
    addNodeDropdown.classList.remove('open');
  });
});
document.addEventListener('click', () => addNodeDropdown.classList.remove('open'));

function changeNodeCategory(node, newCat) {
  if (node.dataset.category === newCat) return;
  node.dataset.category = newCat;
  const titleEl = node.querySelector('.header-title');
  const baseName = titleEl.textContent;
  if (isNodeNameTaken(baseName, newCat, node.id)) {
    let i = 1;
    while (isNodeNameTaken(`${baseName}-${i}`, newCat, node.id)) i++;
    titleEl.textContent = `${baseName}-${i}`;
  }
  const nodeId = node.id;
  connections.forEach(c => {
    if (c.from.nodeId === nodeId) {
      c.line.setAttribute('stroke', getNodeColor(node));
    }
  });
}

document.querySelectorAll('.ctx-category').forEach(item => {
  item.addEventListener('click', () => {
    if (!contextTarget) return;
    const newCat = item.dataset.cat;
    pushUndo();
    const targets = new Set(selectedNodes);
    targets.add(contextTarget);
    targets.forEach(node => changeNodeCategory(node, newCat));
    contextMenu.style.display = 'none';
    contextTarget = null;
  });
});

document.getElementById('ctx-delete-node').addEventListener('click', () => {
  if (!contextTarget) return;
  pushUndo();
  const toDelete = new Set(selectedNodes);
  toDelete.add(contextTarget);

  toDelete.forEach(node => deleteNode(node));

  selectedNodes.clear();
  contextMenu.style.display = 'none';
  contextTarget = null;
});

function deleteSelectedNodes() {
  if (selectedNodes.size === 0) return;
  selectedNodes.forEach(node => deleteNode(node));
  selectedNodes.clear();
}

function deleteNode(node) {
  const ports = node.querySelectorAll('.port');
  ports.forEach(p => removeConnectionsForPort(p));
  selectedNodes.delete(node);
  node.remove();
}

/* ---- Undo / Redo (snapshot-based) ---- */
const _undoStack = [];
const _redoStack = [];
const UNDO_LIMIT = 50;

function takeSnapshot() {
  const nodeEls = [...canvasInner.querySelectorAll('.node')];
  const nodeIdToIndex = {};
  const nodes = nodeEls.map((node, i) => { nodeIdToIndex[node.id] = i; return serializeNodeEl(node); });
  const portToIndex = buildPortMap(nodeEls);
  const conns = serializeConns(nodeIdToIndex, portToIndex);
  return { nodes, connections: conns };
}

function pushUndo() {
  _undoStack.push(takeSnapshot());
  if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
  _redoStack.length = 0;
}

function restoreSnapshot(snapshot) {
  clearCanvas();
  const createdNodes = snapshot.nodes.map(n => deserializeNode(n, n.x, n.y));
  deserializeConns(snapshot.connections, createdNodes);
  refreshConnections();
}

function undo() {
  if (_undoStack.length === 0) return;
  _redoStack.push(takeSnapshot());
  restoreSnapshot(_undoStack.pop());
}

function redo() {
  if (_redoStack.length === 0) return;
  _undoStack.push(takeSnapshot());
  restoreSnapshot(_redoStack.pop());
}

/* ---- Copy / Paste ---- */
let _clipboard = null;

function serializeNodeEl(node) {
  const title = node.querySelector('.header-title').textContent;
  const cat = node.dataset.category || '';
  const descEl = node.querySelector('.node-desc textarea');
  const desc = descEl ? descEl.value : '';
  const descW = descEl ? descEl.offsetWidth : null;
  const descH = descEl ? descEl.offsetHeight : null;
  const ports = [...node.querySelectorAll('.port-row')].map(row => ({
    label: row.querySelector('.port-label').textContent,
    mode: row.dataset.mode || 'both'
  }));
  return { title, desc, descW, descH, category: cat, x: parseInt(node.style.left), y: parseInt(node.style.top), ports };
}

function buildPortMap(nodeEls) {
  const portToIndex = {};
  nodeEls.forEach((node, ni) => {
    const rows = node.querySelectorAll('.port-row');
    rows.forEach((row, ri) => {
      const inputDot = row.querySelector('.port.input');
      const outputDot = row.querySelector('.port.output');
      if (inputDot) portToIndex[inputDot.dataset.portId] = { node: ni, port: ri, type: 'input' };
      if (outputDot) portToIndex[outputDot.dataset.portId] = { node: ni, port: ri, type: 'output' };
    });
  });
  return portToIndex;
}

function serializeConns(nodeIdToIndex, portToIndex) {
  return connections
    .filter(c => nodeIdToIndex[c.from.nodeId] != null && nodeIdToIndex[c.to.nodeId] != null)
    .map(c => ({
      fromNode: nodeIdToIndex[c.from.nodeId],
      fromPort: portToIndex[c.from.portId]?.port ?? 0,
      fromType: portToIndex[c.from.portId]?.type ?? 'output',
      toNode: nodeIdToIndex[c.to.nodeId],
      toPort: portToIndex[c.to.portId]?.port ?? 0,
      toType: portToIndex[c.to.portId]?.type ?? 'input'
    }));
}

function deserializeNode(n, x, y) {
  const cat = n.category || 'styleBlue';
  let title = n.title;
  if (isNodeNameTaken(title, cat, '')) {
    let i = 1;
    while (isNodeNameTaken(`${title}-${i}`, cat, '')) i++;
    title = `${title}-${i}`;
  }
  let ports;
  if (Array.isArray(n.ports)) {
    ports = n.ports;
  } else {
    const inputs = Array.isArray(n.inputs) ? n.inputs : [];
    const outputs = Array.isArray(n.outputs) ? n.outputs : [];
    const maxLen = Math.max(inputs.length, outputs.length);
    ports = [];
    for (let i = 0; i < maxLen; i++) {
      const label = inputs[i] || outputs[i] || `Port ${i + 1}`;
      const hasLeft = i < inputs.length;
      const hasRight = i < outputs.length;
      ports.push({ label, mode: hasLeft && hasRight ? 'both' : hasLeft ? 'left' : 'right' });
    }
  }
  const node = createNode(title, [], [], { category: cat, x, y, desc: n.desc || '', ports });
  if (n.descW || n.descH) {
    const ta = node.querySelector('.node-desc textarea');
    if (ta) {
      if (n.descW) ta.style.width = n.descW + 'px';
      if (n.descH) ta.style.height = n.descH + 'px';
    }
  }
  return node;
}

function deserializeConns(conns, createdNodes) {
  (conns || []).forEach(c => {
    const fromNode = createdNodes[c.fromNode];
    const toNode = createdNodes[c.toNode];
    if (!fromNode || !toNode) return;
    const fromRows = fromNode.querySelectorAll('.port-row');
    const toRows = toNode.querySelectorAll('.port-row');
    const fromRow = fromRows[c.fromPort];
    const toRow = toRows[c.toPort];
    if (!fromRow || !toRow) return;
    const fromType = c.fromType || 'output';
    const toType = c.toType || 'input';
    const fromPort = fromRow.querySelector(`.port.${fromType}`);
    const toPort = toRow.querySelector(`.port.${toType}`);
    if (!fromPort || !toPort) return;
    if (fromPort.classList.contains('hidden-port') || toPort.classList.contains('hidden-port')) return;
    const line = createSVGLine(false);
    line.setAttribute('stroke', getNodeColor(fromNode));
    svg.appendChild(line);
    connections.push({
      from: { nodeId: fromNode.id, portId: fromPort.dataset.portId, el: fromPort },
      to: { nodeId: toNode.id, portId: toPort.dataset.portId, el: toPort },
      line
    });
  });
}

function copySelectedNodes() {
  const nodeEls = [...selectedNodes];
  if (nodeEls.length === 0) return;
  const nodeIdToIndex = {};
  const nodes = nodeEls.map((node, i) => { nodeIdToIndex[node.id] = i; return serializeNodeEl(node); });
  const portToIndex = buildPortMap(nodeEls);
  _clipboard = { nodes, connections: serializeConns(nodeIdToIndex, portToIndex) };
}

function pasteNodes() {
  if (!_clipboard || _clipboard.nodes.length === 0) return;
  let sumX = 0, sumY = 0;
  _clipboard.nodes.forEach(n => { sumX += n.x; sumY += n.y; });
  const centerX = sumX / _clipboard.nodes.length;
  const centerY = sumY / _clipboard.nodes.length;

  let baseX, baseY;
  if (_lastCanvasClick) {
    baseX = _lastCanvasClick.x;
    baseY = _lastCanvasClick.y;
  } else {
    const vc = getViewCenter();
    baseX = vc.x;
    baseY = vc.y;
  }

  _pasteCount++;
  const offset = (_pasteCount - 1) * 30;
  const dx = baseX - centerX + offset;
  const dy = baseY - centerY + offset;

  const createdNodes = _clipboard.nodes.map(n => deserializeNode(n, n.x + dx, n.y + dy));
  deserializeConns(_clipboard.connections, createdNodes);

  clearSelection();
  createdNodes.forEach(n => { selectedNodes.add(n); n.classList.add('selected'); });
  refreshConnections();
}

document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const inText = tag === 'INPUT' || tag === 'TEXTAREA';
  if (inText) return;

  if (e.key === 'Delete' && selectedNodes.size > 0) { pushUndo(); deleteSelectedNodes(); return; }
  if (e.ctrlKey && e.key === 'c' && selectedNodes.size > 0) { copySelectedNodes(); return; }
  if (e.ctrlKey && e.key === 'v') { e.preventDefault(); pushUndo(); pasteNodes(); return; }
  if (e.ctrlKey && e.shiftKey && e.key === 'Z') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); return; }
});

/* ---- Export / Import Blueprint ---- */
function exportBlueprint() {
  const nodeEls = [...canvasInner.querySelectorAll('.node')];
  if (nodeEls.length === 0) { alert('畫面上沒有任何 Node'); return; }

  const nodeIdToIndex = {};
  const nodes = nodeEls.map((node, i) => { nodeIdToIndex[node.id] = i; return serializeNodeEl(node); });
  const portToIndex = buildPortMap(nodeEls);
  const conns = serializeConns(nodeIdToIndex, portToIndex);

  const blueprint = { nodes, connections: conns };
  const json = JSON.stringify(blueprint, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'blueprint.nodeBlueprint';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importBlueprint() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.nodeBlueprint';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const blueprint = JSON.parse(text);
      clearCanvas();
      loadBlueprint(blueprint);
    } catch (e) {
      alert('匯入失敗：檔案格式不正確');
    }
  });
  input.click();
}

function clearCanvas() {
  canvasInner.querySelectorAll('.node').forEach(node => node.remove());
  connections.forEach(c => c.line.remove());
  connections = [];
  selectedNodes.clear();
}

function resolveUniqueName(name, node) {
  const nodeType = getNodeType(node);
  if (!isNodeNameTaken(name, nodeType, node.id)) return name;
  let i = 1;
  while (isNodeNameTaken(`${name}__duplicate${i}`, nodeType, node.id)) i++;
  return `${name}__duplicate${i}`;
}

function loadBlueprint(blueprint) {
  const createdNodes = blueprint.nodes.map(n => deserializeNode(n, n.x, n.y));
  deserializeConns(blueprint.connections, createdNodes);
  refreshConnections();

  if (createdNodes.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    createdNodes.forEach(n => {
      const x = parseInt(n.style.left) || 0;
      const y = parseInt(n.style.top) || 0;
      const w = n.offsetWidth;
      const h = n.offsetHeight;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    });
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const canvasW = canvas.clientWidth;
    const canvasH = canvas.clientHeight;
    panX = canvasW / 2 - centerX * scale;
    panY = canvasH / 2 - centerY * scale;
    applyTransform();
    refreshConnections();
  }
  applyFilter();
}

function refreshConnections() {
  connections.forEach(c => {
    const from = getPortCenter(c.from.el);
    const to = getPortCenter(c.to.el);
    c.line.setAttribute('d', buildCurvePath(from.x, from.y, to.x, to.y));
  });
}

/* ---- Filter ---- */
const activeFilters = new Set(['styleBlue', 'stylePurple', 'styleRed', 'styleYellow', 'styleGreen', 'styleWhite', 'styleGray']);

function applyFilter() {
  canvasInner.querySelectorAll('.node').forEach(node => {
    const cat = getNodeCategory(node);
    const dimmed = !activeFilters.has(cat);
    node.classList.toggle('dimmed', dimmed);
    if (dimmed && selectedNodes.has(node)) {
      selectedNodes.delete(node);
      node.classList.remove('selected');
    }
  });
  connections.forEach(c => {
    const fromNode = document.getElementById(c.from.nodeId);
    const toNode = document.getElementById(c.to.nodeId);
    const fromCat = fromNode ? getNodeCategory(fromNode) : '';
    const toCat = toNode ? getNodeCategory(toNode) : '';
    c.line.classList.toggle('dimmed', !activeFilters.has(fromCat));
  });
}

const selectAllCb = document.getElementById('filter-select-all');
const filterCbs = document.querySelectorAll('#filter-panel input[data-filter]');

function syncSelectAll() {
  const allChecked = [...filterCbs].every(cb => cb.checked);
  const someChecked = [...filterCbs].some(cb => cb.checked);
  selectAllCb.checked = allChecked;
  selectAllCb.indeterminate = !allChecked && someChecked;
}

selectAllCb.addEventListener('change', () => {
  filterCbs.forEach(cb => {
    cb.checked = selectAllCb.checked;
    const cat = cb.dataset.filter;
    if (cb.checked) activeFilters.add(cat);
    else activeFilters.delete(cat);
  });
  applyFilter();
});

filterCbs.forEach(cb => {
  cb.addEventListener('change', () => {
    const cat = cb.dataset.filter;
    if (cb.checked) activeFilters.add(cat);
    else activeFilters.delete(cat);
    syncSelectAll();
    applyFilter();
  });
});

/* ---- Node Template Registration ---- */
nodeConfigs['styleBlue']   = { type: 'styleBlue',   title: '樣式藍', color: '#5b9bf0' };
nodeConfigs['stylePurple'] = { type: 'stylePurple', title: '樣式紫', color: '#9d6ee8' };
nodeConfigs['styleRed']    = { type: 'styleRed',    title: '樣式紅', color: '#ef6b6b' };
nodeConfigs['styleYellow'] = { type: 'styleYellow', title: '樣式黃', color: '#ebc44e' };
nodeConfigs['styleGreen']  = { type: 'styleGreen',  title: '樣式綠', color: '#58d468' };
nodeConfigs['styleWhite']  = { type: 'styleWhite',  title: '樣式白', color: '#d0d4e0' };
nodeConfigs['styleGray']   = { type: 'styleGray',   title: '樣式灰', color: '#8a8e9e' };
