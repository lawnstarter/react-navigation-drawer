import * as React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import {
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';
import { getAnimatedStyle } from 'react-native-reanimated';

import Drawer from '../Drawer';

const SETTLE_MS = 2000;

type TestProps = Partial<React.ComponentProps<typeof Drawer>>;

function renderDrawer(props: TestProps = {}) {
  const onOpen = jest.fn();
  const onClose = jest.fn();
  const element = (overrides: TestProps) => (
    <Drawer
      open={false}
      onOpen={onOpen}
      onClose={onClose}
      gestureEnabled
      drawerPosition="left"
      drawerType="front"
      keyboardDismissMode="none"
      swipeVelocityThreshold={500}
      hideStatusBar={false}
      statusBarAnimation="none"
      renderDrawerContent={() => <Text>drawer</Text>}
      renderSceneContent={() => <Text>scene</Text>}
      {...props}
      {...overrides}
    />
  );
  const utils = render(element({}));
  const drawerView = () => utils.getByTestId('drawer-container');

  return {
    ...utils,
    onOpen,
    onClose,
    rerenderWith: (overrides: TestProps) => utils.rerender(element(overrides)),
    layoutDrawer: (width: number) =>
      fireEvent(drawerView(), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 800 } },
      }),
    layoutContainer: (width: number) =>
      fireEvent(utils.getByTestId('drawer-main'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 800 } },
      }),
    translateX: () =>
      (getAnimatedStyle(drawerView()).transform as { translateX: number }[])[0]
        .translateX,
  };
}

function settle() {
  act(() => {
    jest.advanceTimersByTime(SETTLE_MS);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// On device the UI thread applies the animated style after the first layout.
// If that style carries its own width, the drawer is measured at one width
// and drawn at another, and while closed the difference sticks out on screen.
describe('Drawer width', () => {
  it('leaves the width to drawerStyle, not the animated style', () => {
    const drawer = renderDrawer({ drawerStyle: { width: 280 } });
    drawer.layoutDrawer(280);
    settle();

    const style = getAnimatedStyle(drawer.getByTestId('drawer-container'));
    expect(style.width).toBe(280);
  });
});

describe('Drawer translateX follows `open`', () => {
  it('opens fully when `open` is true before the first layout', () => {
    const drawer = renderDrawer({ open: true });

    drawer.layoutDrawer(280);
    settle();

    expect(drawer.translateX()).toBe(280);
  });

  it('opens fully when `open` flips to true before the first layout', () => {
    const drawer = renderDrawer();

    drawer.rerenderWith({ open: true });
    drawer.layoutDrawer(280);
    settle();

    expect(drawer.translateX()).toBe(280);
  });

  // The first layout uses the `drawerStyle` width; a later layout can report a
  // different one, e.g. once the animated `width: '80%'` style lands on the UI
  // thread or the screen rotates.
  it('re-targets an open drawer when its width changes after the first layout', () => {
    const drawer = renderDrawer({ open: true });

    drawer.layoutDrawer(280);
    settle();
    drawer.layoutDrawer(329);
    settle();

    expect(drawer.translateX()).toBe(329);
  });

  it('closes when `open` flips while a pan that opens it finalizes', () => {
    const drawer = renderDrawer();
    drawer.layoutDrawer(280);
    settle();

    act(() => {
      fireGestureHandler(getByGestureTestId('drawer-pan'), [
        { state: State.BEGAN, absoluteX: 5, translationX: 0 },
        { state: State.ACTIVE, absoluteX: 105, translationX: 100 },
        { state: State.ACTIVE, absoluteX: 205, translationX: 200 },
        { state: State.END, absoluteX: 205, translationX: 200, velocityX: 0 },
      ]);
    });
    // The navigator never applies the open request (e.g. it navigated away),
    // so the `open` prop stays false.
    drawer.rerenderWith({ open: false });
    settle();

    expect(drawer.onOpen).toHaveBeenCalled();
    expect(drawer.translateX()).toBe(0);
  });

  // translationX is cumulative from the gesture start, so a drag of 150px must
  // move the drawer by 150px no matter how many update events report it.
  it('follows the finger during a pan', () => {
    const drawer = renderDrawer();
    drawer.layoutDrawer(280);
    settle();

    act(() => {
      fireGestureHandler(getByGestureTestId('drawer-pan'), [
        { state: State.BEGAN, absoluteX: 5, translationX: 0 },
        { state: State.ACTIVE, absoluteX: 55, translationX: 50 },
        { state: State.ACTIVE, absoluteX: 105, translationX: 100 },
        { state: State.ACTIVE, absoluteX: 155, translationX: 150 },
      ]);
    });

    expect(drawer.translateX()).toBe(150);
  });

  it('opens when a pan that closes it finalizes after `open` became true', () => {
    const drawer = renderDrawer();
    drawer.layoutDrawer(280);
    settle();

    act(() => {
      fireGestureHandler(getByGestureTestId('drawer-pan'), [
        { state: State.BEGAN, absoluteX: 5, translationX: 0 },
        { state: State.ACTIVE, absoluteX: 8, translationX: 3 },
        { state: State.ACTIVE, absoluteX: 10, translationX: 5 },
      ]);
    });
    drawer.rerenderWith({ open: true });
    act(() => {
      fireGestureHandler(getByGestureTestId('drawer-pan'), [
        { state: State.ACTIVE, absoluteX: 10, translationX: 5 },
        { state: State.END, absoluteX: 10, translationX: 5, velocityX: 0 },
      ]);
    });
    settle();

    expect(drawer.translateX()).toBe(280);
  });
});

describe('Drawer container touches', () => {
  it('lets touches through while closed, before and after layout', () => {
    const drawer = renderDrawer();

    expect(drawer.getByTestId('drawer-container').props.pointerEvents).toBe(
      'none'
    );

    drawer.layoutDrawer(280);
    settle();

    expect(drawer.getByTestId('drawer-container').props.pointerEvents).toBe(
      'none'
    );
  });

  it('takes touches while open and lets them through again once closed', () => {
    const drawer = renderDrawer({ open: true });

    drawer.layoutDrawer(280);
    settle();

    expect(drawer.getByTestId('drawer-container').props.pointerEvents).toBe(
      'auto'
    );

    drawer.rerenderWith({ open: false });
    settle();

    expect(drawer.getByTestId('drawer-container').props.pointerEvents).toBe(
      'none'
    );
  });
});

type SwipeCase = {
  name: string;
  props: TestProps;
  startX: number;
  panTo: number;
  velocityX: number;
  expected: 'onOpen' | 'onClose';
};

const OPEN_LEFT: TestProps = { open: true };
const OPEN_RIGHT: TestProps = { open: true, drawerPosition: 'right' };
const CLOSED_RIGHT: TestProps = { drawerPosition: 'right' };

const swipeCases: SwipeCase[] = [
  {
    name: 'closes an open drawer on a fast swipe toward closed',
    props: OPEN_LEFT,
    startX: 300,
    panTo: -180,
    velocityX: -1500,
    expected: 'onClose',
  },
  {
    name: 'closes an open drawer on a slow drag past the threshold',
    props: OPEN_LEFT,
    startX: 300,
    panTo: -100,
    velocityX: 0,
    expected: 'onClose',
  },
  {
    name: 'keeps an open drawer open on a slow drag short of the threshold',
    props: OPEN_LEFT,
    startX: 300,
    panTo: -10,
    velocityX: 0,
    expected: 'onOpen',
  },
  {
    name: 'keeps a closed drawer closed on a slow drag short of the threshold',
    props: {},
    startX: 5,
    panTo: 10,
    velocityX: 0,
    expected: 'onClose',
  },
  {
    name: 'opens a closed drawer on a slow drag past the threshold',
    props: {},
    startX: 5,
    panTo: 200,
    velocityX: 0,
    expected: 'onOpen',
  },
  {
    name: 'opens a closed drawer on a fast swipe toward open',
    props: {},
    startX: 5,
    panTo: 30,
    velocityX: 1500,
    expected: 'onOpen',
  },
  {
    name: 'keeps an open drawer open when the release flicks toward open',
    props: OPEN_LEFT,
    startX: 300,
    panTo: -100,
    velocityX: 1500,
    expected: 'onOpen',
  },
  {
    name: 'closes an open right drawer on a fast swipe toward closed',
    props: OPEN_RIGHT,
    startX: 300,
    panTo: 180,
    velocityX: 1500,
    expected: 'onClose',
  },
  {
    name: 'opens a closed right drawer on a fast swipe from the right edge',
    props: CLOSED_RIGHT,
    startX: 395,
    panTo: -200,
    velocityX: -1500,
    expected: 'onOpen',
  },
];

describe('Drawer swipe decision', () => {
  it.each(swipeCases)(
    '$name',
    ({ props, startX, panTo, velocityX, expected }) => {
      const drawer = renderDrawer(props);
      if (props.drawerPosition === 'right') {
        drawer.layoutContainer(400);
      }
      drawer.layoutDrawer(280);
      settle();

      act(() => {
        fireGestureHandler(getByGestureTestId('drawer-pan'), [
          { state: State.BEGAN, absoluteX: startX, translationX: 0 },
          { state: State.ACTIVE, absoluteX: startX, translationX: 0 },
          {
            state: State.ACTIVE,
            absoluteX: startX + panTo,
            translationX: panTo,
          },
          {
            state: State.END,
            absoluteX: startX + panTo,
            translationX: panTo,
            velocityX,
          },
        ]);
      });
      settle();

      const other = expected === 'onOpen' ? 'onClose' : 'onOpen';
      expect(drawer[expected]).toHaveBeenCalledTimes(1);
      expect(drawer[other]).not.toHaveBeenCalled();
    }
  );
});
