import * as React from 'react';
import { SharedValue } from 'react-native-reanimated';

export default React.createContext<SharedValue<number> | null>(null);
