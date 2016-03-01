declare var describe, it, expect, hot, cold, expectObservable, expectSubscriptions, console, beforeEach;
require('es6-shim');
import 'reflect-metadata';
import {Observable} from 'rxjs/Observable';
import {Injector, provide} from 'angular2/core';
import {Dispatcher, provideStore, Store, StoreBackend} from '@ngrx/store';

import { StoreDevtoolActions, StoreDevtools, instrumentStore } from '../src/store';

function counter(state = 0, action) {
  switch (action.type) {
  case 'INCREMENT': return state + 1;
  case 'DECREMENT': return state - 1;
  default: return state;
  }
}

declare var mistake;
function counterWithBug(state = 0, action) {
  switch (action.type) {
    case 'INCREMENT': return state + 1;
    case 'DECREMENT': return mistake - 1; // mistake is undefined
    case 'SET_UNDEFINED': return undefined;
    default: return state;
  }
}

function doubleCounter(state = 0, action) {
  switch (action.type) {
  case 'INCREMENT': return state + 2;
  case 'DECREMENT': return state - 2;
  default: return state;
  }
}

describe('instrument', () => {
  let store: Store<any>;
  let devtools: StoreDevtools;

  function createStore(reducer, monitorReducer = T => T){
    const injector = Injector.resolveAndCreate([
      provideStore(reducer),
      instrumentStore(monitorReducer)
    ]);

    const store = injector.get(Store);
    const devtools = injector.get(StoreDevtools);

    return { store, devtools };
  }

  beforeEach(() => {
    const result = createStore(counter);
    devtools = result.devtools;
    store = result.store;
  });

  it('should alias devtools to the store backend', () => {
    const injector = Injector.resolveAndCreate([
      provideStore(counter),
      instrumentStore()
    ]);

    const devtools = injector.get(StoreDevtools);
    const backend = injector.get(StoreBackend);

    expect(devtools).toBe(backend);
  });

  it('should perform actions', () => {
    expect(store.getValue()).toBe(0);
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(1);
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(2);
  });

  it('should rollback state to the last committed state', () => {
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(2);

    devtools.dispatch(StoreDevtoolActions.commit());
    expect(store.getValue()).toBe(2);

    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(4);

    devtools.dispatch(StoreDevtoolActions.rollback());
    expect(store.getValue()).toBe(2);

    store.dispatch({ type: 'DECREMENT' });
    expect(store.getValue()).toBe(1);

    devtools.dispatch(StoreDevtoolActions.rollback());
    expect(store.getValue()).toBe(2);
  });

  it('should reset to initial state', () => {
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(1);

    devtools.dispatch(StoreDevtoolActions.commit());
    expect(store.getValue()).toBe(1);

    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(2);

    devtools.dispatch(StoreDevtoolActions.rollback());
    expect(store.getValue()).toBe(1);

    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(2);

    devtools.dispatch(StoreDevtoolActions.reset());
    expect(store.getValue()).toBe(0);
  });

  it('should toggle an action', () => {
    // actionId 0 = @@INIT
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'DECREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(1);

    devtools.dispatch(StoreDevtoolActions.toggleAction(2));
    expect(store.getValue()).toBe(2);

    devtools.dispatch(StoreDevtoolActions.toggleAction(2));
    expect(store.getValue()).toBe(1);
  });

  it('should sweep disabled actions', () => {
    // actionId 0 = @@INIT
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'DECREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });

    expect(store.getValue()).toBe(2);
    expect(devtools.state$.getValue().stagedActionIds).toEqual([0, 1, 2, 3, 4]);
    expect(devtools.state$.getValue().skippedActionIds).toEqual([]);

    devtools.dispatch(StoreDevtoolActions.toggleAction(2));
    expect(store.getValue()).toBe(3);
    expect(devtools.state$.getValue().stagedActionIds).toEqual([0, 1, 2, 3, 4]);
    expect(devtools.state$.getValue().skippedActionIds).toEqual([2]);

    devtools.dispatch(StoreDevtoolActions.sweep());
    expect(store.getValue()).toBe(3);
    expect(devtools.state$.getValue().stagedActionIds).toEqual([0, 1, 3, 4]);
    expect(devtools.state$.getValue().skippedActionIds).toEqual([]);
  });

  it('should jump to state', () => {
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'DECREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(1);

    devtools.dispatch(StoreDevtoolActions.jumpToState(0));
    expect(store.getValue()).toBe(0);

    devtools.dispatch(StoreDevtoolActions.jumpToState(1));
    expect(store.getValue()).toBe(1);

    devtools.dispatch(StoreDevtoolActions.jumpToState(2));
    expect(store.getValue()).toBe(0);

    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(0);

    devtools.dispatch(StoreDevtoolActions.jumpToState(4));
    expect(store.getValue()).toBe(2);
  });

  it('should replace the reducer', () => {
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'DECREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(1);

    store.replaceReducer(doubleCounter);
    expect(store.getValue()).toBe(2);
  });

  it('should catch and record errors', () => {
    spyOn(console, 'error');
    let { store, devtools } = createStore(counterWithBug);

    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'DECREMENT' });
    store.dispatch({ type: 'INCREMENT' });

    let { computedStates } = devtools.state$.getValue();
    expect(computedStates[2].error).toMatch(
      /ReferenceError/
    );
    expect(computedStates[3].error).toMatch(
      /Interrupted by an error up the chain/
    );

    expect(console.error).toHaveBeenCalled();
  });

  it('should catch invalid action type', () => {
    expect(() => {
      store.dispatch({ type: undefined });
    }).toThrowError(
      'Actions may not have an undefined "type" property. ' +
      'Have you misspelled a constant?'
    );
  });

  xit('should return the last non-undefined state from getValue', () => {
    let { store } = createStore(counterWithBug);
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getValue()).toBe(2);

    store.dispatch({ type: 'SET_UNDEFINED' });
    expect(store.getValue()).toBe(2);
  });

  it('should not recompute old states when toggling an action', () => {
    let reducerCalls = 0;
    let {store, devtools} = createStore(() => reducerCalls++);
    reducerCalls = 1; // @ngrx/store calls the reducer during setup

    expect(reducerCalls).toBe(1);
    // actionId 0 = @@INIT
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(reducerCalls).toBe(4);

    devtools.dispatch(StoreDevtoolActions.toggleAction(3));
    expect(reducerCalls).toBe(4);

    devtools.dispatch(StoreDevtoolActions.toggleAction(3));
    expect(reducerCalls).toBe(5);

    devtools.dispatch(StoreDevtoolActions.toggleAction(2));
    expect(reducerCalls).toBe(6);

    devtools.dispatch(StoreDevtoolActions.toggleAction(2));
    expect(reducerCalls).toBe(8);

    devtools.dispatch(StoreDevtoolActions.toggleAction(1));
    expect(reducerCalls).toBe(10);

    devtools.dispatch(StoreDevtoolActions.toggleAction(2));
    expect(reducerCalls).toBe(11);

    devtools.dispatch(StoreDevtoolActions.toggleAction(3));
    expect(reducerCalls).toBe(11);

    devtools.dispatch(StoreDevtoolActions.toggleAction(1));
    expect(reducerCalls).toBe(12);

    devtools.dispatch(StoreDevtoolActions.toggleAction(3));
    expect(reducerCalls).toBe(13);

    devtools.dispatch(StoreDevtoolActions.toggleAction(2));
    expect(reducerCalls).toBe(15);
  });

  it('should not recompute states when jumping to state', () => {
    let reducerCalls = 0;
    let {store, devtools} = createStore(() => reducerCalls++);
    reducerCalls = 1; // @ngrx/store calls the reducer during setup

    expect(reducerCalls).toBe(1);
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(reducerCalls).toBe(4);

    let savedComputedStates = devtools.state$.getValue().computedStates;

    devtools.dispatch(StoreDevtoolActions.jumpToState(0));
    expect(reducerCalls).toBe(4);

    devtools.dispatch(StoreDevtoolActions.jumpToState(1));
    expect(reducerCalls).toBe(4);

    devtools.dispatch(StoreDevtoolActions.jumpToState(3));
    expect(reducerCalls).toBe(4);

    expect(devtools.state$.getValue().computedStates).toBe(savedComputedStates);
  });

  it('should not recompute states on monitor actions', () => {
    let reducerCalls = 0;
    let {store, devtools} = createStore(() => reducerCalls++);
    reducerCalls = 1; // @ngrx/store calls the reducer during setup

    expect(reducerCalls).toBe(1);
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(reducerCalls).toBe(4);

    let savedComputedStates = devtools.state$.getValue().computedStates;

    devtools.dispatch({ type: 'lol' });
    expect(reducerCalls).toBe(4);

    devtools.dispatch({ type: 'wat' });
    expect(reducerCalls).toBe(4);

    expect(devtools.state$.getValue().computedStates).toBe(savedComputedStates);
  });

  describe('Import State', () => {
    let exportedState;

    beforeEach(() => {
      store.dispatch({ type: 'INCREMENT' });
      store.dispatch({ type: 'INCREMENT' });
      store.dispatch({ type: 'INCREMENT' });

      exportedState = devtools.state$.getValue();
    });

    it('should replay all the steps when a state is imported', () => {
      let {store, devtools} = createStore(counter);

      devtools.dispatch(StoreDevtoolActions.importState(exportedState));
      expect(devtools.state$.getValue()).toEqual(exportedState);
    });

    it('should replace the existing action log with the one imported', () => {
      let {store, devtools} = createStore(counter);

      store.dispatch({ type: 'DECREMENT' });
      store.dispatch({ type: 'DECREMENT' });

      devtools.dispatch(StoreDevtoolActions.importState(exportedState));
      expect(devtools.state$.getValue()).toEqual(exportedState);
    });
  });
});
