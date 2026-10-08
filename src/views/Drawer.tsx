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
  useAnimatedStyle,
  useSharedValue,
  useDerivedValue,
  withSpring,
  runOnJS,
  interpolate,
  type SharedValue,
  Extrapolation,
} from 'react-native-reanimated';
import DrawerProgressContext from '../utils/DrawerProgressContext';

const SWIPE_DISTANCE_MINIMUM = 5;
const SWIPE_DISTANCE_THRESHOLD_DEFAULT = 20;
const SWIPE_EDGE_WIDTH_DEFAULT = 32;

const SPRING_CONFIG = {
  damping: 500,
  mass: 3,
  stiffness: 1000,
  overshootClamping: true,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01,
};

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onGestureRef?: (ref: PanGestureHandler | null) => void;
  gestureEnabled: boolean;
  drawerPosition: 'left' | 'right';
  drawerType: 'front' | 'back' | 'slide';
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

  // Open/close effect — runs on JS thread, withSpring works from JS in Reanimated 3+
  React.useEffect(() => {
    if (open) {
      const target = drawerWidth.value * (drawerPosition === 'right' ? -1 : 1);
      if (drawerWidth.value > 0) {
        translateX.value = withSpring(target, SPRING_CONFIG);
      }
      toggleStatusBar(true);
    } else {
      translateX.value = withSpring(0, SPRING_CONFIG);
      toggleStatusBar(false);
    }
  }, [open, drawerPosition]);

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
    .enabled(gestureEnabled)
    .hitSlop(edgeHitSlop)
    .activeOffsetX([-SWIPE_DISTANCE_MINIMUM, SWIPE_DISTANCE_MINIMUM])
    .failOffsetY([-SWIPE_DISTANCE_MINIMUM, SWIPE_DISTANCE_MINIMUM])
    .onTouchesDown((event) => {
      'worklet';
      isValidStart.value =
        event.allTouches[0].absoluteX < swipeDistanceThreshold || open;
    })
    .onStart(() => {
      'worklet';
      isSwiping.value = isValidStart.value;
    })
    .onUpdate((event) => {
      'worklet';
      if (!isSwiping.value) return;

      const dragX = translateX.value + event.translationX;
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

      const isRightDrawer = drawerPosition === 'right';
      const targetValue = shouldOpen
        ? isRightDrawer
          ? -drawerWidth.value
          : drawerWidth.value
        : 0;

      translateX.value = withSpring(targetValue, SPRING_CONFIG);
      isSwiping.value = false;

      if (shouldOpen) {
        runOnJS(onOpen)();
      } else {
        runOnJS(onClose)();
      }
    });

  const overlayGesture = Gesture.Tap()
    .enabled(gestureEnabled)
    .simultaneousWithExternalGesture(panGesture)
    .onEnd(() => {
      'worklet';
      runOnJS(onClose)();
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
      position: 'absolute' as const,
      top: 0,
      bottom: 0,
      width: '80%',
      maxWidth: '100%',
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
    const width = e.nativeEvent.layout.width;
    const prevWidth = drawerWidth.value;
    drawerWidth.value = width;

    // If the drawer is open and we just got a valid width measurement,
    // snap translateX to the correct position
    if (open && width > 0 && prevWidth === 0) {
      translateX.value = width * (drawerPosition === 'right' ? -1 : 1);
    }
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
  container: {
    backgroundColor: 'white',
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
