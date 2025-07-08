import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { PopupMenu } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Glib from 'gi://GLib';
import St from 'gi://St';

const PRESSURE_THRESHOLD = 150;
const PRESSURE_TIMEOUT = 1000;
const EDGE_WIDTH_PERCENT = 1.0;
const LOG_PREFIX = '[PeekHotEdge]';

const PeekHotEdge = GObject.registerClass(
class PeekHotEdge extends Clutter.Actor {
  _init(monitor, triggerAction, leaveAction) {
    const width = monitor.width * EDGE_WIDTH_PERCENT;
    const xOffset = monitor.x + (monitor.width - width) / 2;

    super._init({
      name: 'peek-hot-edge',
      reactive: true,
      x: xOffset,
      y: monitor.y,
      width: width,
      height: 1,
    });

    this._monitor = monitor;
    this._triggerAction = triggerAction;
    this._leaveAction = leaveAction;
    this._isActive = false;
    this._panelLeaveHandlerId = null;
    this._barrier = null;
    this._pressureBarrier = null;

    this._setupPressureBarrier();
    Main.layoutManager.addChrome(this);
  }

  _setupPressureBarrier() {
    if ((global.backend.capabilities & Meta.BackendCapabilities.BARRIERS) === 0) {
      log(LOG_PREFIX + ' No barrier support. Using fallback hover mode.');
      this.connect('enter-event', this._onEnterFallback.bind(this));
      this.connect('leave-event', this._onLeaveFallback.bind(this));
      return;
    }

    log(LOG_PREFIX + ' Using pressure barrier.');

    this._pressureBarrier = new Layout.PressureBarrier(
      PRESSURE_THRESHOLD,
      PRESSURE_TIMEOUT,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW
    );

    const width = this.width;
    const x1 = this.x;
    const x2 = this.x + width;
    const y = this.y;

    this._barrier = new Meta.Barrier({
      x1: x1, x2: x2,
      y1: y, y2: y,
      directions: Meta.BarrierDirection.POSITIVE_Y,
      backend: global.backend,
    });

    this._pressureBarrier.addBarrier(this._barrier);
    this._pressureBarrier.connect('trigger', this._onPressureTrigger.bind(this));
  }

  _onPressureTrigger() {
    if (!this._isActive) {
      this._isActive = true;
      this._triggerAction();

      if (!this._panelLeaveHandlerId) {
        this._panelLeaveHandlerId = Main.panel.connect('leave-event', this._onPanelLeave.bind(this));
      }
    }
  }

  _onPanelLeave() {
    const [px, py] = global.get_pointer();
    const actorNow = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, px, py);
    const isStillOver = Main.panel.contains(actorNow) || this.contains(actorNow);

    if (!isStillOver && this._isActive && !isAnyPanelMenuOpen()) {
      this._deactivate();
    }
  }

  _onEnterFallback() {
    this._onPressureTrigger();
  }

  _onLeaveFallback() {
    this._onPanelLeave();
  }

  _deactivate() {
    this._isActive = false;
    this._leaveAction();

    if (this._panelLeaveHandlerId) {
      Main.panel.disconnect(this._panelLeaveHandlerId);
      this._panelLeaveHandlerId = null;
    }
  }

  destroy() {
    if (this._panelLeaveHandlerId)
      Main.panel.disconnect(this._panelLeaveHandlerId);

    if (this._barrier && this._pressureBarrier) {
      this._pressureBarrier.removeBarrier(this._barrier);
      this._barrier.destroy();
      this._barrier = null;
    }

    if (this._pressureBarrier) {
      this._pressureBarrier.destroy();
      this._pressureBarrier = null;
    }

    Main.layoutManager.removeChrome(this);
    super.destroy();
  }
}

);

class WaylandPanelManager {
  constructor() {
    this._dummyButton = null;
    this._dummyMenu = null;
    this._createInvisibleMenu();
  }

  static createAndInitialize() {
    return new WaylandPanelManager();
  }

  _createInvisibleMenu() {
    this._dummyButton = new St.Bin({ reactive: false, visible: false });
    Main.panel._rightBox.insert_child_at_index(this._dummyButton, 0);

    this._dummyMenu = new PopupMenu(this._dummyButton, 0.5, St.Side.TOP);
    this._dummyMenu.actor.set_position(0, -100);
    Main.uiGroup.add_child(this._dummyMenu.actor);
  }

  _openInvisibleMenu() {
    if (this._dummyMenu && !this._dummyMenu.isOpen)
      this._dummyMenu.open();
  }

  _closeInvisibleMenu() {
    if (this._dummyMenu && this._dummyMenu.isOpen)
      this._dummyMenu.close();
  }

  showPanel() {
    this._openInvisibleMenu();
    const panel = Main.layoutManager.panelBox;

    panel.translation_y = -panel.height;
    panel.visible = true;
    panel.ease({
      translation_y: 0,
      duration: 250,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        panel.translation_y = 0;
      }
    });
  }

  hidePanel() {
    const panel = Main.layoutManager.panelBox;
    panel.ease({
      translation_y: -panel.height,
      duration: 250,
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      onComplete: () => {
        if (!Main.layoutManager.primaryMonitor.inFullscreen) {
          panel.ease({
            translation_y: 0,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => panel.translation_y = 0
          });
          return;
        }

        panel.visible = false;
        panel.translation_y = 0;
        this._closeInvisibleMenu();
      }
    });
  }

  dispose() {
    this._closeInvisibleMenu();
    if (this._dummyMenu) this._dummyMenu.destroy();
    if (this._dummyButton) Main.panel._rightBox.remove_child(this._dummyButton);
    Main.layoutManager.panelBox.visible = true;
    Main.layoutManager.panelBox.translation_y = 0;
  }
}

function isAnyPanelMenuOpen() {
  const statusArea = Main.layoutManager.panelBox.get_children()[0].statusArea;
  return Object.values(statusArea).some(indicator => indicator.menu?.isOpen);
}

function toggleAnyIndicator() {
  const statusArea = Main.layoutManager.panelBox.get_children()[0].statusArea;
  const closed = Object.values(statusArea).filter(ind => ind.menu && !ind.menu.isOpen);
  if (closed.length > 0) {
    closed[0].menu.toggle();
    closed[0].menu.toggle();
  }
}

function delay(ms) {
  return new Promise(resolve => {
    Glib.timeout_add(Glib.PRIORITY_DEFAULT, ms, () => {
      resolve();
      return Glib.SOURCE_REMOVE;
    });
  });
}

class PeekTopBarExtension extends Extension {
  constructor() {
    super(...arguments);
    this.hotEdge = null;
    this.hotCornersSub = null;
    this.panelManager = null;
    this._menuSignals = [];
  }

  enable() {
    this.panelManager = WaylandPanelManager.createAndInitialize();

    this.hotCornersSub = Main.layoutManager.connect("hot-corners-changed", () => this.setupHotEdge());
    this.setupHotEdge();

    const statusArea = Main.layoutManager.panelBox.get_children()[0].statusArea;
    const indicators = Object.values(statusArea).filter(i => i.menu);

    for (const indicator of indicators) {
      const id = indicator.menu.connect('open-state-changed', () => {
        Glib.idle_add(Glib.PRIORITY_DEFAULT_IDLE, () => {
          if (!isAnyPanelMenuOpen() && !Main.panel.contains(global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, ...global.get_pointer()))) {
            this.hotEdge?._deactivate();
          }
          return Glib.SOURCE_REMOVE;
        });
      });
      this._menuSignals.push({ indicator, id });
    }
  }

  setupHotEdge() {
    this.hotEdge?.destroy();

    const monitor = Main.layoutManager.primaryMonitor;
    this.hotEdge = new PeekHotEdge(
      monitor,
      () => {
        if (monitor.inFullscreen)
          this.panelManager.showPanel();
      },
      () => {
        if (!monitor.inFullscreen || Main.layoutManager._inOverview) {
          toggleAnyIndicator();
          return;
        }

        delay(200).then(() => {
          if (!monitor.inFullscreen || Main.layoutManager._inOverview) {
            toggleAnyIndicator();
          } else {
            this.panelManager.hidePanel();
          }
        });
      }
    );

    Main.layoutManager.hotCorners.push(this.hotEdge);
  }

  disable() {
    this.hotEdge?.destroy();
    this.hotEdge = null;

    if (this.hotCornersSub) {
      Main.layoutManager.disconnect(this.hotCornersSub);
      this.hotCornersSub = null;
    }

    this.panelManager?.dispose();
    this.panelManager = null;

    for (const { indicator, id } of this._menuSignals) {
      indicator.menu.disconnect(id);
    }
    this._menuSignals = [];

    Main.layoutManager._updateHotCorners();
  }
}

export default PeekTopBarExtension;
