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
  withSpring,
  runOnJS,
  interpolate,
  cancelAnimation,
  Extrapolation,
} from 'react-native-reanimated';
import DrawerProgressContext from '../utils/DrawerProgressContext';

const PROGRESS_EPSILON = 0.05;
const SWIPE_DISTANCE_MINIMUM = 5;
const SWIPE_DISTANCE_THRESHOLD_DEFAULT = 60;

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
  swipeEdgeWidth: number;
  swipeDistanceThreshold?: number;
  swipeVelocityThreshold: number;
  hideStatusBar: boolean;
  statusBarAnimation: 'slide' | 'none' | 'fade';
  overlayStyle?: ViewStyle;
  drawerStyle?: ViewStyle;
  sceneContainerStyle?: ViewStyle;
  renderDrawerContent: (props: {
    progress: Animated.SharedValue<number>;
  }) => React.ReactNode;
  renderSceneContent: (props: {
    progress: Animated.SharedValue<number>;
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
  const progress = useSharedValue(0);
  const translateX = useSharedValue(0);
  const drawerWidth = useSharedValue(0);
  const containerWidth = useSharedValue(0);
  const isSwiping = useSharedValue(false);
  const isStatusBarHidden = React.useRef(false);

  const toggleStatusBar = React.useCallback(
    (hidden: boolean) => {
      if (hideStatusBar && isStatusBarHidden.current !== hidden) {
        isStatusBarHidden.current = hidden;
        StatusBar.setHidden(hidden, statusBarAnimation);
      }
    },
    [hideStatusBar, statusBarAnimation]
  );

  const animateDrawer = React.useCallback((toValue: number) => {
    'worklet';
    cancelAnimation(translateX);
    translateX.value = withSpring(toValue, SPRING_CONFIG);
    progress.value = Math.abs(toValue) / (drawerWidth.value || 1);
  }, []);

  React.useEffect(() => {
    if (open) {
      animateDrawer(drawerWidth.value * (drawerPosition === 'right' ? -1 : 1));
    } else {
      animateDrawer(0);
    }
  }, [open, drawerPosition, animateDrawer]);

  const panGesture = Gesture.Pan()
    .enabled(gestureEnabled)
    .activeOffsetX([-SWIPE_DISTANCE_MINIMUM, SWIPE_DISTANCE_MINIMUM])
    .failOffsetY([-SWIPE_DISTANCE_MINIMUM, SWIPE_DISTANCE_MINIMUM])
    .onStart(() => {
      'worklet';
      const startX = translateX.value;
      isSwiping.value = true;
      runOnJS(toggleStatusBar)(true);
      return { startX };
    })
    .onUpdate((event) => {
      'worklet';
      const dragX = translateX.value + event.translationX;
      const isRightDrawer = drawerPosition === 'right';

      if (isRightDrawer) {
        translateX.value = Math.max(Math.min(dragX, 0), -drawerWidth.value);
      } else {
        translateX.value = Math.min(Math.max(dragX, 0), drawerWidth.value);
      }

      progress.value = Math.abs(translateX.value) / (drawerWidth.value || 1);
    })
    .onFinalize((event) => {
      'worklet';
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

      animateDrawer(targetValue);
      isSwiping.value = false;
      runOnJS(toggleStatusBar)(shouldOpen);

      if (shouldOpen) {
        runOnJS(onOpen)();
      } else {
        runOnJS(onClose)();
      }
    });

  const tapGestureHandler = Gesture.Tap()
    .enabled(gestureEnabled)
    .onEnd(() => {
      if (progress.value > PROGRESS_EPSILON) {
        runOnJS(onClose)();
      }
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
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: '80%',
      maxWidth: '100%',
      ...(drawerPositionValue === 'right'
        ? { right: offsetValue }
        : { left: offsetValue }),
      zIndex: drawerType === 'back' ? -1 : 0,
      // Add opacity that only shows drawer after layout
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
    pointerEvents: progress.value > 0 ? 'auto' : 'none',
  }));

  const handleDrawerLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    drawerWidth.value = width;
    if (open) {
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
            <GestureDetector gesture={tapGestureHandler}>
              <Animated.View
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
    opacity: 0,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
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
