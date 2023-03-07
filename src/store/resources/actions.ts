import { ActionTree } from 'vuex';
import { StateInterface } from 'src/store/index';
import { DelegatedResources, ResourcesStateInterface } from 'src/store/resources/state';
import { GetTableRowsParams } from 'src/types';
import { api } from 'src/api';
import { SignTransactionResponse } from 'universal-authenticator-library';
import { getChain } from 'src/config/ConfigManager';

const chain = getChain();
const symbol = chain.getSystemToken().symbol;
const precision = chain.getSystemToken().precision;

export const actions: ActionTree<ResourcesStateInterface, StateInterface> = {

    // general update action to assert all resources related data is loaded for the current account
    async updateResources(store, force = false) {
        console.log('updateResources() inicio');
        try {
            store.commit('setLoading', 'updateResources');
            store.commit('setForceUpdate', force);
            if (
                store.state.currentAccount !== store.rootState.account.accountName ||
                !store.rootState.account.data ||
                force
            ) {
                // dispatch updateSelfStaked and updateDelegatedToOthers actions in parallel awaiting for both to finish
                await Promise.all([
                    store.dispatch('updateSelfStaked', store.rootState.account.accountName),
                    store.dispatch('updateDelegatedToOthers', store.rootState.account.accountName),
                ]);
                store.commit('setCurrentAccount', store.rootState.account.accountName);
            }
            console.log('updateResources() fin');
        } catch (err) {
            console.log('Error', err);
        } finally {
            store.commit('setForceUpdate', false);
            store.commit('unsetLoading', 'updateResources');
        }
    },

    // self staked resources actions
    async updateSelfStaked(store, account: string) {
        console.log('updateSelfStaked() inicio');
        try {
            store.commit('setLoading', 'updateSelfStaked');
            if (
                store.state.currentAccount !== account ||
                store.state.selfStaked?.from !== account ||
                store.state.selfStaked?.to !== account
            ) {
                // dispatch loadAccountData action from account module
                await store.dispatch('account/loadAccountData', account, { root: true });
            }

            const accountData = store.rootState.account.data;

            // self staked resources
            const self_net_weight = Number(accountData.self_delegated_bandwidth?.cpu_weight.value ?? 0);
            const self_cpu_weight = Number(accountData.self_delegated_bandwidth?.net_weight.value ?? 0);

            const self_net_asset = `${self_net_weight.toFixed(precision)} ${symbol}`;
            const self_cpu_asset = `${self_cpu_weight.toFixed(precision)} ${symbol}`;

            const selfStaked: DelegatedResources = {
                from: account,
                to: account,
                net_weight: self_net_asset,
                cpu_weight: self_cpu_asset,
            };

            // total staked resources
            const total_net_weight = Number(accountData.net_weight.value) / Math.pow(10, precision);
            const total_cpu_weight = Number(accountData.cpu_weight.value) / Math.pow(10, precision);

            // resources delegated from others
            const from_others_net_weight = total_net_weight - self_net_weight;
            const from_others_cpu_weight = total_cpu_weight - self_cpu_weight;

            const from_others_net_asset = `${from_others_net_weight.toFixed(precision)} ${symbol}`;
            const from_others_cpu_asset = `${from_others_cpu_weight.toFixed(precision)} ${symbol}`;

            const fromOthers: DelegatedResources = {
                from: 'not-available',
                to: account,
                net_weight: from_others_net_asset,
                cpu_weight: from_others_cpu_asset,
            };

            store.commit('setDelegatedFromOthers', fromOthers);
            store.commit('setSelfStaked', selfStaked);
            console.log('updateSelfStaked() fin', selfStaked);
        } catch (err) {
            console.log('Error', err);
        } finally {
            store.commit('unsetLoading', 'updateSelfStaked');
        }
    },

    // delegated resources actions
    async updateDelegatedToOthers({ commit }, account: string) {
        try {
            commit('setLoading', 'updateDelegatedToOthers');

            const paramsdelband = {
                code: 'eosio',
                limit: '200',
                scope: account,
                table: 'delband',
            } as GetTableRowsParams;

            const delegated = (
                (await api.getTableRows(paramsdelband)) as {
                    rows: DelegatedResources[];
                }
            ).rows;

            commit('setCurrentAccount', account);
            commit('setDelegatedToOthers', delegated);
        } catch (err) {
            console.log('Error', err);
        } finally {
            commit('unsetLoading', 'updateDelegatedToOthers');
        }
    },
    async delegateResources({ commit, dispatch }, order: DelegatedResources) {
        const { from, to, net_weight, cpu_weight } = order;

        // create two actions, one for the delegatebw and one for the transfer
        try {
            void commit('setLoading', 'delegateResources');

            // calculate the total amount
            const amount = Number(net_weight) + Number(cpu_weight);

            const actions = [
                {
                    account: 'eosio',
                    name: 'delegatebw',
                    authorization: [
                        {
                            actor: from,
                            permission: 'active',
                        },
                    ],
                    data: {
                        from,
                        receiver: to,
                        stake_net_quantity: net_weight,
                        stake_cpu_quantity: cpu_weight,
                        transfer: false,
                        amount,
                    },
                },
            ];
            const transaction = (await dispatch('sendTransaction', actions)) as undefined as SignTransactionResponse;
            commit('setTransaction', transaction.transactionId);
        } catch (e) {
            commit('setTransactionError', e);
        } finally {
            void commit('unsetLoading', 'delegateResources');
        }
    },
    async undelegateResources({ commit, dispatch }, order: DelegatedResources) {
        const { from, to, net_weight, cpu_weight } = order;
        console.log('undelegateResources()');

        // create two actions, one for the delegatebw and one for the transfer
        try {
            void commit('setLoading', 'undelegateResources');

            const actions = [
                {
                    account: 'eosio',
                    name: 'undelegatebw',
                    authorization: [
                        {
                            actor: from,
                            permission: 'active',
                        },
                    ],
                    data: {
                        from,
                        receiver: to,
                        unstake_net_quantity: net_weight,
                        unstake_cpu_quantity: cpu_weight,
                    },
                },
            ];
            await dispatch('account/sendTransaction', actions, { root: true });
        } catch (e) {
            console.log('Error', e);
        } finally {
            void commit('unsetLoading', 'undelegateResources');
        }
    },
};

// include all actiuons in the interface as collable full-typed functions
export interface ResourcesActions {
    updateResources: (force?: boolean) => Promise<void>;
    updateSelfStaked: (account: string) => Promise<void>;
    updateDelegatedToOthers: (account: string) => Promise<void>;
    delegateResources: (order: DelegatedResources) => Promise<void>;
    undelegateResources: (order: DelegatedResources) => Promise<void>;
}
