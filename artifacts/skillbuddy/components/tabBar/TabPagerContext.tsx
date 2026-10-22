import React from 'react';

/**
 * The tab index the navigator is currently focused on (0–4).
 *
 * The pager's continuous `position` lives inside react-native-tab-view; this
 * context adds the discrete index the navigation state is on, which the page
 * polish needs to know which way a drag is going. It changes once per tab
 * change, never per frame.
 */
export const TabPagerIndexContext = React.createContext(0);
