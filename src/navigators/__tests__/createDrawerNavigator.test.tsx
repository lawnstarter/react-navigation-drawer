import * as React from 'react';
import { Text, View } from 'react-native';
import { render } from '@testing-library/react-native';
import { createAppContainer } from 'react-navigation';

import createDrawerNavigator from '../createDrawerNavigator';

class HomeScreen extends React.Component {
  static navigationOptions = ({ navigation }: any) => ({
    title: `Welcome ${
      navigation.state.params ? navigation.state.params.user : 'anonymous'
    }`,
    gesturesEnabled: true,
  });

  render() {
    return (
      <View style={{ flex: 1 }}>
        <Text>Home screen</Text>
      </View>
    );
  }
}

it('renders successfully', () => {
  const MyDrawerNavigator = createDrawerNavigator({ Home: HomeScreen });
  const App = createAppContainer(MyDrawerNavigator);
  const { queryByText, queryByTestId } = render(<App />);

  expect(queryByText('Home screen')).not.toBeNull();
  expect(queryByTestId('drawer-container')).not.toBeNull();
});
