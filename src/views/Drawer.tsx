import * as React from 'react';
import {
  StyleSheet,
  ViewStyle,
  LayoutChangeEvent,
  I18nManager,
  Platform,
  StatusBar,
} from 'react-native';
import {
  PanGestureHandler,
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  useDerivedValue,
  withSpring,
  interpolate,
  SharedValue,
  Extrapolation,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import DrawerProgressContext from '../utils/DrawerProgressContext';

const SWIPE_DISTANCE_MINIMUM = 5;
const SWIPE_DISTANCE_THRESHOLD_DEFAULT = 20;
const SWIPE_EDGE_WIDTH_DEFAULT = 32;

const SPRING_CONFIG = {
  damping: 500,
  mass: 3,
  stiffness: 1000,
  overshootClamping: true,
};

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  // Passed by DrawerView; unused since the move to the Gesture API.
  // eslint-disable-next-line react/no-unused-prop-types
  onGestureRef?: (ref: PanGestureHandler | null) => void;
  gestureEnabled: boolean;
  drawerPosition: 'left' | 'right';
  drawerType: 'front' | 'back' | 'slide';
  // eslint-disable-next-line react/no-unused-prop-types
  keyboardDismissMode: 'none' | 'on-drag';
  swipeEdgeWidth?: number;
  swipeDistanceThreshold?: number;
  swipeVelocityThreshold: number;
  hideStatusBar: boolean;
  statusBarAnimation: 'slide' | 'none' | 'fade';
  overlayStyle?: ViewStyle;
  drawerStyle?: ViewStyle;
  sceneContainerStyle?: ViewStyle;
  renderDrawerContent: (props: {
    progress: SharedValue<number>;
  }) => React.ReactNode;
  renderSceneContent: (props: {
    progress: SharedValue<number>;
  }) => React.ReactNode;
  // eslint-disable-next-line react/no-unused-prop-types
  gestureHandlerProps?: React.ComponentProps<typeof PanGestureHandler>;
};

const Drawer = ({
  open,
  onOpen,
  onClose,
  gestureEnabled = true,
  drawerPosition = I18nManager.isRTL ? 'left' : 'right',
  drawerType = 'front',
  swipeEdgeWidth = SWIPE_EDGE_WIDTH_DEFAULT,
  swipeDistanceThreshold = SWIPE_DISTANCE_THRESHOLD_DEFAULT,
  swipeVelocityThreshold = 500,
  hideStatusBar = false,
  statusBarAnimation = 'slide',
  overlayStyle,
  drawerStyle,
  sceneContainerStyle,
  renderDrawerContent,
  renderSceneContent,
}: Props) => {
  const translateX = useSharedValue(0);
  const drawerWidth = useSharedValue(0);
  const containerWidth = useSharedValue(0);
  const isSwiping = useSharedValue(false);
  const isValidStart = useSharedValue(false);
  const dragStartX = useSharedValue(0);
  // The `open` prop, mirrored to the UI thread.
  const isOpen = useSharedValue(open);
  // True from the end of a swipe until the navigator answers the onOpen/onClose
  // request, so the drawer holds still instead of springing to the old state.
  const isAwaitingNavigator = useSharedValue(false);
  const awaitingNavigatorTimeout = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const isStatusBarHidden = React.useRef(false);

  // Derive progress reactively from translateX and drawerWidth on the UI thread
  const progress = useDerivedValue(() => {
    if (drawerWidth.value === 0) return 0;
    return Math.abs(translateX.value) / drawerWidth.value;
  });

  const toggleStatusBar = React.useCallback(
    (hidden: boolean) => {
      if (hideStatusBar) {
        isStatusBarHidden.current = hidden;
        StatusBar.setHidden(hidden, statusBarAnimation);
      }
    },
    [hideStatusBar, statusBarAnimation]
  );

  React.useEffect(() => {
    toggleStatusBar(open);
  }, [open, toggleStatusBar]);

  // `open` is the only source of truth for where the drawer rests. Re-assert it
  // on every render: a render means the navigator has answered any pending
  // swipe, even when it left `open` unchanged.
  React.useEffect(() => {
    clearTimeout(awaitingNavigatorTimeout.current);
    isOpen.value = open;
    isAwaitingNavigator.value = false;
  });

  React.useEffect(
    () => () => clearTimeout(awaitingNavigatorTimeout.current),
    []
  );

  // The only writer that springs translateX. It runs on the UI thread whenever
  // `open`, the measured width or the swipe state changes, so the resting
  // position always matches `open`, whatever order those changes land in.
  useAnimatedReaction(
    () => ({
      open: isOpen.value,
      width: drawerWidth.value,
      isSettling: !isSwiping.value && !isAwaitingNavigator.value,
    }),
    (current, previous) => {
      if (!current.isSettling || current.width === 0) return;

      const target = current.open
        ? current.width * (drawerPosition === 'right' ? -1 : 1)
        : 0;

      // Before the first measurement the drawer is hidden, so jump straight
      // to where it belongs instead of animating in from the closed position.
      if (previous == null || previous.width === 0) {
        translateX.value = target;
      } else {
        translateX.value = withSpring(target, SPRING_CONFIG);
      }
    },
    [drawerPosition]
  );

  const handleSwipeEnd = (shouldOpen: boolean) => {
    if (shouldOpen) {
      onOpen();
    } else {
      onClose();
    }

    // The navigator re-renders this drawer when it handles the request. If it
    // never does, stop holding after a tick so the drawer settles on `open`.
    clearTimeout(awaitingNavigatorTimeout.current);
    awaitingNavigatorTimeout.current = setTimeout(() => {
      isAwaitingNavigator.value = false;
    }, 0);
  };

  // While closed, only a touch that starts at the drawer's edge may activate the
  // pan. Without this, any horizontal drag over SWIPE_DISTANCE_MINIMUM anywhere on
  // the screen activates it and cancels the touch of every horizontal ScrollView
  // or FlatList in the scene. While open, the whole area stays draggable so the
  // drawer can be swiped closed.
  const edgeHitSlop =
    drawerPosition === 'right'
      ? { right: 0, width: open ? undefined : swipeEdgeWidth }
      : { left: 0, width: open ? undefined : swipeEdgeWidth };

  const panGesture = Gesture.Pan()
    .withTestId('drawer-pan')
    .enabled(gestureEnabled)
    .hitSlop(edgeHitSlop)
    .activeOffsetX([-SWIPE_DISTANCE_MINIMUM, SWIPE_DISTANCE_MINIMUM])
    .failOffsetY([-SWIPE_DISTANCE_MINIMUM, SWIPE_DISTANCE_MINIMUM])
    .onBegin((event) => {
      'worklet';
      isValidStart.value = event.absoluteX < swipeDistanceThreshold || open;
    })
    .onStart(() => {
      'worklet';
      dragStartX.value = translateX.value;
      isSwiping.value = isValidStart.value;
    })
    .onUpdate((event) => {
      'worklet';
      if (!isSwiping.value) return;

      // translationX is cumulative since the gesture started.
      const dragX = dragStartX.value + event.translationX;
      const isRightDrawer = drawerPosition === 'right';

      if (isRightDrawer) {
        translateX.value = Math.max(Math.min(dragX, 0), -drawerWidth.value);
      } else {
        translateX.value = Math.min(Math.max(dragX, 0), drawerWidth.value);
      }
    })
    .onFinalize((event) => {
      'worklet';
      if (!isSwiping.value) return;

      const velocity = event.velocityX;
      const shouldOpen =
        Math.abs(velocity) > swipeVelocityThreshold ||
        Math.abs(translateX.value) > swipeDistanceThreshold;

      // Hand the decision to the navigator; the reaction above moves the
      // drawer once `open` reflects it.
      isAwaitingNavigator.value = true;
      isSwiping.value = false;
      scheduleOnRN(handleSwipeEnd, shouldOpen);
    });

  const overlayGesture = Gesture.Tap()
    .enabled(gestureEnabled)
    .simultaneousWithExternalGesture(panGesture)
    .onEnd(() => {
      'worklet';
      scheduleOnRN(onClose);
    });

  const drawerAnimatedStyle = useAnimatedStyle(() => {
    const drawerPositionValue = drawerPosition === 'right' ? 'right' : 'left';
    const offsetValue =
      drawerType === 'back'
        ? I18nManager.isRTL
          ? -drawerWidth.value
          : drawerWidth.value
        : -drawerWidth.value;

    return {
      transform: [{ translateX: translateX.value }],
      ...(drawerPositionValue === 'right'
        ? { right: offsetValue }
        : { left: offsetValue }),
      zIndex: drawerType === 'back' ? -1 : 0,
      opacity: drawerWidth.value === 0 ? 0 : 1,
    };
  });

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: drawerType === 'front' ? 0 : translateX.value,
      },
    ],
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const overlayPointerEvents = open ? 'auto' : 'none';

  const handleDrawerLayout = (e: LayoutChangeEvent) => {
    drawerWidth.value = e.nativeEvent.layout.width;
  };

  const handleContainerLayout = (e: LayoutChangeEvent) => {
    containerWidth.value = e.nativeEvent.layout.width;
  };

  return (
    <DrawerProgressContext.Provider value={progress}>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={styles.main} onLayout={handleContainerLayout}>
          <Animated.View
            style={[styles.content, contentAnimatedStyle, sceneContainerStyle]}
            importantForAccessibility={open ? 'no-hide-descendants' : 'yes'}
          >
            {renderSceneContent({ progress })}
            <GestureDetector gesture={overlayGesture}>
              <Animated.View
                pointerEvents={overlayPointerEvents}
                style={[styles.overlay, overlayAnimatedStyle, overlayStyle]}
              />
            </GestureDetector>
          </Animated.View>

          <Animated.View
            accessibilityViewIsModal={open}
            removeClippedSubviews={Platform.OS !== 'ios'}
            onLayout={handleDrawerLayout}
            testID="drawer-container"
            style={[styles.container, drawerAnimatedStyle, drawerStyle]}
          >
            {renderDrawerContent({ progress })}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </DrawerProgressContext.Provider>
  );
};

const styles = StyleSheet.create({
  // Static so that drawerStyle, which comes after it, sets the width. The
  // closed offset uses the measured width, so the drawer must not be drawn at
  // a different width than the one it was laid out at.
  container: {
    backgroundColor: 'white',
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '80%',
    maxWidth: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  content: {
    flex: 1,
  },
  main: {
    flex: 1,
    overflow: 'hidden',
  },
});

export default Drawer;
