/**
 * Minimal dependency-injection container.
 *
 * registerSingleton: factory is invoked once, on first resolve(); the same
 * instance is returned on every later resolve() call. This is where the
 * "singleton" behavior lives — plain classes never implement it themselves.
 *
 * registerInstance: register an already-constructed value (e.g. the mongoose
 * connection) directly, no factory needed.
 */
class Container {
  constructor() {
    this._registrations = new Map();
  }

  registerSingleton(name, factory) {
    if (typeof factory !== 'function') {
      throw new TypeError(`registerSingleton("${name}") requires a factory function`);
    }
    this._registrations.set(name, { factory, instance: undefined, resolved: false });
    return this;
  }

  registerInstance(name, instance) {
    this._registrations.set(name, { factory: null, instance, resolved: true });
    return this;
  }

  resolve(name) {
    const registration = this._registrations.get(name);
    if (!registration) {
      throw new Error(`No registration found for "${name}"`);
    }
    if (!registration.resolved) {
      registration.instance = registration.factory(this);
      registration.resolved = true;
    }
    return registration.instance;
  }

  has(name) {
    return this._registrations.has(name);
  }
}

module.exports = Container;
