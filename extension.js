import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import GLib from 'gi://GLib';

function __decorate(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}

function registerGObjectClass(target) {
  if (Object.prototype.hasOwnProperty.call(target, "metaInfo")) {
    return GObject.registerClass(target.metaInfo, target);
  } else {
    return GObject.registerClass(target);
  }
}

class Barrier {
  constructor(position, hitDirection, triggerMode, triggerAction) {
    this.position = position;
    this.hitDirection = hitDirection;
    this.triggerMode = triggerMode;
    this.triggerAction = triggerAction;
  }

  activate() {
    this.pressureBarrier = new Layout.PressureBarrier(
      this.triggerMode === TriggerMode.Delayed ? 15 : 0,
      this.triggerMode === TriggerMode.Delayed ? 200 : 0,
      Shell.ActionMode.NORMAL
    );
    this.pressureBarrier.connect("trigger", this.onTrigger.bind(this));
    const { x1, x2, y1, y2 } = this.position;
    this.nativeBarrier = new Meta.Barrier({
      backend: global.backend,
      x1,
      x2,
      y1,
      y2,
      directions: this.hitDirection === HitDirection.FromBottom
        ? Meta.BarrierDirection.POSITIVE_Y
        : Meta.BarrierDirection.NEGATIVE_Y,
    });
    this.pressureBarrier.addBarrier(this.nativeBarrier);
  }

  onTrigger() {
    this.triggerAction();
  }

  dispose() {
    if (!this.nativeBarrier) return;
    this.pressureBarrier?.removeBarrier(this.nativeBarrier);
    this.nativeBarrier.destroy();
    this.nativeBarrier = null;
    this.pressureBarrier?.destroy();
    this.pressureBarrier = null;
  }
}

var HitDirection;
(function(HitDirection) {
  HitDirection[HitDirection["FromTop"] = 0] = "FromTop";
  HitDirection[HitDirection["FromBottom"] = 1] = "FromBottom";
})(HitDirection || (HitDirection = {}));

var TriggerMode;
(function(TriggerMode) {
  TriggerMode[TriggerMode["Instant"] = 0] = "Instant";
  TriggerMode[TriggerMode["Delayed"] = 1] = "Delayed";
})(TriggerMode || (TriggerMode = {}));

class CursorPositionLeaveDetector {
  constructor(position, hitDirection, leaveAction, leaveCondition) {
    this.position = position;
    this.leaveAction = leaveAction;
    this.leaveCondition = leaveCondition;
    this.timeoutId = null;
    this.boundsChecker =
      hitDirection === HitDirection.FromBottom
        ? this.fromBottomBoundsChecker
        : this.fromTopBoundsChecker;
  }

  activate() {
    this.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
      if (!this.isOutOfBounds() || !this.leaveCondition?.()) {
        return GLib.SOURCE_CONTINUE;
      }
      this.leaveAction();
      return GLib.SOURCE_REMOVE;
    });
  }

  dispose() {
    if (this.timeoutId) {
      GLib.source_remove(this.timeoutId);
      this.timeoutId = null;
    }
  }

  isOutOfBounds() {
    let [_, mouse_y, __] = global.get_pointer();
    return this.boundsChecker(mouse_y);
  }

  fromTopBoundsChecker(mouseY) {
    return this.position.y1 < mouseY;
  }

  fromBottomBoundsChecker(mouseY) {
    return this.position.y1 > mouseY;
  }
}

let HotEdge = class HotEdge extends Clutter.Actor {
  constructor(monitor, leaveOffset, triggerAction, leaveAction, leaveCondition) {
    super();
    this.monitor = monitor;
    this.leaveOffset = leaveOffset;
    this.triggerAction = triggerAction;
    this.leaveAction = leaveAction;
    this.leaveCondition = leaveCondition;
    this.barrier = null;
    this.leaveDetector = null;
    this._isTriggered = false;
    this.connect("destroy", this.dispose.bind(this));
  }

  initialize() {
    const { x, y, width } = this.monitor;
    this.barrier = new Barrier({
      x1: x,
      x2: x + width,
      y1: y + 1,
      y2: y + 1,
    }, HitDirection.FromBottom, TriggerMode.Delayed, this.onEnter.bind(this));
    this.barrier.activate();
  }

  onEnter() {
    if (this._isTriggered) return;
    this._isTriggered = true;
    const { x, y, width } = this.monitor;
    this.leaveDetector = new CursorPositionLeaveDetector({
      x1: x,
      x2: x + width,
      y1: y + this.leaveOffset,
      y2: y + this.leaveOffset,
    }, HitDirection.FromTop, this.onLeave.bind(this), this.leaveCondition);
    this.leaveDetector.activate();
    this.triggerAction();
  }

  onLeave() {
    if (!this._isTriggered) return;
    this._isTriggered = false;
    this.disposeOfLeaveDetector();
    this.leaveAction();
  }

  dispose() {
    this.barrier?.dispose();
    this.barrier = null;
    this.disposeOfLeaveDetector();
  }

  disposeOfLeaveDetector() {
    this.leaveDetector?.dispose();
    this.leaveDetector = null;
  }
};
HotEdge = __decorate([
  registerGObjectClass
], HotEdge);

function isFullscreen(monitor) {
  return monitor.inFullscreen;
}

function isInOverview() {
  return Main.layoutManager._inOverview;
}

let timeoutSourceIds = [];
function delay(ms) {
  return new Promise(resolve => {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      removeFinishedTimeoutId(id);
      resolve();
      return GLib.SOURCE_REMOVE;
    });
    timeoutSourceIds.push(id);
  });
}

function removeFinishedTimeoutId(id) {
  timeoutSourceIds?.splice(timeoutSourceIds.indexOf(id), 1);
}

function disposeDelayTimeouts() {
  timeoutSourceIds?.forEach(id => GLib.source_remove(id));
  timeoutSourceIds = null;
}

const PanelBox = Main.layoutManager.panelBox;

class WaylandPanelManager {
  constructor(extensionPath) {
    this.extensionPath = extensionPath;
  }

  static createAndInitialize(extensionPath) {
    const manager = new WaylandPanelManager(extensionPath);
    manager.spawnDummyApp();
    return manager;
  }

  showPanel() {
    PanelBox.translation_y = -PanelBox.height;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
      PanelBox.visible = true;

      // Step 3: Animate in
      PanelBox.ease({
        translation_y: 0,
        duration: 250,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });

      return GLib.SOURCE_REMOVE;
    });
  }

  hidePanel() {
    PanelBox.ease({
      translation_y: -PanelBox.height,
      duration: 250,
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      onComplete: () => {
        PanelBox.visible = false;
        PanelBox.translation_y = 0;
      }
    });
  }

  dispose() {
    GLib.spawn_command_line_async('pkill -f "marcinjahn.com/dummy-window.js"');
  }

  spawnDummyApp() {
    GLib.spawn_command_line_async(`sh -c "GDK_BACKEND=x11 gjs ${this.extensionPath}/dummy-window.js"`);
  }
}

class X11PanelManager {
  showPanel() {
    PanelBox.translation_y = -PanelBox.height;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
      PanelBox.visible = true;

      // Step 3: Animate in
      PanelBox.ease({
        translation_y: 0,
        duration: 250,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });

      return GLib.SOURCE_REMOVE;
    });
  }

  hidePanel() {
    PanelBox.ease({
      translation_y: -PanelBox.height,
      duration: 250,
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      onComplete: () => {
        PanelBox.visible = false;
        PanelBox.translation_y = 0;
      }
    });
  }

  dispose() { }
}

function getPanelHeight() {
  return PanelBox.get_children()[0].height;
}

function isAnyPanelMenuOpen() {
  const statusArea = PanelBox.get_children()[0].statusArea;
  return Object.values(statusArea)
    .filter(i => i.menu?.isOpen).length > 0;
}

function toggleAnyIndicator() {
  const statusArea = PanelBox.get_children()[0].statusArea;
  const closed = Object.values(statusArea).filter(i => !i.menu?.isOpen);
  if (closed.length > 0) {
    closed[0].menu.toggle();
    closed[0].menu.toggle();
  }
}

class PeekTopBarOnFullscreenExtension extends Extension {
  constructor() {
    super(...arguments);
    this.hotEdge = null;
    this.hotCornersSub = null;
    this.panelManager = null;
  }

  enable() {
    if (Meta.is_wayland_compositor()) {
      this.panelManager = WaylandPanelManager.createAndInitialize(this.path);
    } else {
      this.panelManager = new X11PanelManager();
    }

    this.hotCornersSub = Main.layoutManager.connect("hot-corners-changed", () => {
      this.setupHotEdge();
    });

    this.setupHotEdge();
    this.panelManager?.hidePanel();
  }

  setupHotEdge() {
    this.hotEdge?.dispose();
    const monitor = Main.layoutManager.primaryMonitor;
    this.hotEdge = new HotEdge(
      monitor,
      getPanelHeight(),
      () => {
        if (isFullscreen(monitor)) {
          this.panelManager?.showPanel();
        }
      },
      () => {
        if (!isFullscreen(monitor) || isInOverview()) {
          toggleAnyIndicator();
          return;
        }

        delay(200).then(() => {
          if (!isFullscreen(monitor) || isInOverview()) {
            toggleAnyIndicator();
            return;
          }
          this.panelManager?.hidePanel();
        });
      },
      () => !isAnyPanelMenuOpen() || isInOverview()
    );
    this.hotEdge.initialize();
    Main.layoutManager.hotCorners.push(this.hotEdge);
  }

  disable() {
    this.hotEdge?.dispose();
    this.hotEdge = null;
    Main.layoutManager.disconnect(this.hotCornersSub);
    this.hotCornersSub = null;
    this.panelManager?.dispose();
    this.panelManager = null;
    disposeDelayTimeouts();
    Main.layoutManager._updateHotCorners();
  }
}

export default PeekTopBarOnFullscreenExtension;
