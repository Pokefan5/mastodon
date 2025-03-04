import PropTypes from 'prop-types';

import { defineMessages, injectIntl } from 'react-intl';

import classNames from 'classnames';
import { Helmet } from 'react-helmet';

import Immutable from 'immutable';
import ImmutablePropTypes from 'react-immutable-proptypes';
import ImmutablePureComponent from 'react-immutable-pure-component';
import { connect } from 'react-redux';
import { createSelector } from 'reselect';

import { HotKeys } from 'react-hotkeys';

import { initBlockModal } from 'flavours/glitch/actions/blocks';
import { initBoostModal } from 'flavours/glitch/actions/boosts';
import {
  replyCompose,
  mentionCompose,
  directCompose,
} from 'flavours/glitch/actions/compose';
import {
  favourite,
  unfavourite,
  bookmark,
  unbookmark,
  reblog,
  unreblog,
  pin,
  unpin,
} from 'flavours/glitch/actions/interactions';
import { changeLocalSetting } from 'flavours/glitch/actions/local_settings';
import { openModal } from 'flavours/glitch/actions/modal';
import { initMuteModal } from 'flavours/glitch/actions/mutes';
import { initReport } from 'flavours/glitch/actions/reports';
import {
  fetchStatus,
  muteStatus,
  unmuteStatus,
  deleteStatus,
  editStatus,
  hideStatus,
  revealStatus,
  translateStatus,
  undoStatusTranslation,
} from 'flavours/glitch/actions/statuses';
import { Icon } from 'flavours/glitch/components/icon';
import { LoadingIndicator } from 'flavours/glitch/components/loading_indicator';
import { textForScreenReader, defaultMediaVisibility } from 'flavours/glitch/components/status';
import ScrollContainer from 'flavours/glitch/containers/scroll_container';
import StatusContainer from 'flavours/glitch/containers/status_container';
import BundleColumnError from 'flavours/glitch/features/ui/components/bundle_column_error';
import Column from 'flavours/glitch/features/ui/components/column';
import { boostModal, favouriteModal, deleteModal } from 'flavours/glitch/initial_state';
import { makeGetStatus, makeGetPictureInPicture } from 'flavours/glitch/selectors';
import { autoUnfoldCW } from 'flavours/glitch/utils/content_warning';

import ColumnHeader from '../../components/column_header';
import { attachFullscreenListener, detachFullscreenListener, isFullscreen } from '../ui/util/fullscreen';

import ActionBar from './components/action_bar';
import DetailedStatus from './components/detailed_status';

const messages = defineMessages({
  deleteConfirm: { id: 'confirmations.delete.confirm', defaultMessage: 'Delete' },
  deleteMessage: { id: 'confirmations.delete.message', defaultMessage: 'Are you sure you want to delete this status?' },
  redraftConfirm: { id: 'confirmations.redraft.confirm', defaultMessage: 'Delete & redraft' },
  redraftMessage: { id: 'confirmations.redraft.message', defaultMessage: 'Are you sure you want to delete this status and re-draft it? Favourites and boosts will be lost, and replies to the original post will be orphaned.' },
  revealAll: { id: 'status.show_more_all', defaultMessage: 'Show more for all' },
  hideAll: { id: 'status.show_less_all', defaultMessage: 'Show less for all' },
  statusTitleWithAttachments: { id: 'status.title.with_attachments', defaultMessage: '{user} posted {attachmentCount, plural, one {an attachment} other {# attachments}}' },
  detailedStatus: { id: 'status.detailed_status', defaultMessage: 'Detailed conversation view' },
  replyConfirm: { id: 'confirmations.reply.confirm', defaultMessage: 'Reply' },
  replyMessage: { id: 'confirmations.reply.message', defaultMessage: 'Replying now will overwrite the message you are currently composing. Are you sure you want to proceed?' },
  tootHeading: { id: 'account.posts_with_replies', defaultMessage: 'Posts and replies' },
});

const makeMapStateToProps = () => {
  const getStatus = makeGetStatus();
  const getPictureInPicture = makeGetPictureInPicture();

  const getAncestorsIds = createSelector([
    (_, { id }) => id,
    state => state.getIn(['contexts', 'inReplyTos']),
  ], (statusId, inReplyTos) => {
    let ancestorsIds = Immutable.List();
    ancestorsIds = ancestorsIds.withMutations(mutable => {
      let id = statusId;

      while (id && !mutable.includes(id)) {
        mutable.unshift(id);
        id = inReplyTos.get(id);
      }
    });

    return ancestorsIds;
  });

  const getDescendantsIds = createSelector([
    (_, { id }) => id,
    state => state.getIn(['contexts', 'replies']),
    state => state.get('statuses'),
  ], (statusId, contextReplies, statuses) => {
    let descendantsIds = [];
    const ids = [statusId];

    while (ids.length > 0) {
      let id        = ids.pop();
      const replies = contextReplies.get(id);

      if (statusId !== id) {
        descendantsIds.push(id);
      }

      if (replies) {
        replies.reverse().forEach(reply => {
          if (!ids.includes(reply) && !descendantsIds.includes(reply) && statusId !== reply) ids.push(reply);
        });
      }
    }

    let insertAt = descendantsIds.findIndex((id) => statuses.get(id).get('in_reply_to_account_id') !== statuses.get(id).get('account'));
    if (insertAt !== -1) {
      descendantsIds.forEach((id, idx) => {
        if (idx > insertAt && statuses.get(id).get('in_reply_to_account_id') === statuses.get(id).get('account')) {
          descendantsIds.splice(idx, 1);
          descendantsIds.splice(insertAt, 0, id);
          insertAt += 1;
        }
      });
    }

    return Immutable.List(descendantsIds);
  });

  const mapStateToProps = (state, props) => {
    const status = getStatus(state, { id: props.params.statusId });

    let ancestorsIds   = Immutable.List();
    let descendantsIds = Immutable.List();

    if (status) {
      ancestorsIds   = getAncestorsIds(state, { id: status.get('in_reply_to_id') });
      descendantsIds = getDescendantsIds(state, { id: status.get('id') });
    }

    return {
      isLoading: state.getIn(['statuses', props.params.statusId, 'isLoading']),
      status,
      ancestorsIds,
      descendantsIds,
      settings: state.get('local_settings'),
      askReplyConfirmation: state.getIn(['local_settings', 'confirm_before_clearing_draft']) && state.getIn(['compose', 'text']).trim().length !== 0,
      domain: state.getIn(['meta', 'domain']),
      pictureInPicture: getPictureInPicture(state, { id: props.params.statusId }),
    };
  };

  return mapStateToProps;
};

const truncate = (str, num) => {
  const arr = Array.from(str);
  if (arr.length > num) {
    return arr.slice(0, num).join('') + '…';
  } else {
    return str;
  }
};

const titleFromStatus = (intl, status) => {
  const displayName = status.getIn(['account', 'display_name']);
  const username = status.getIn(['account', 'username']);
  const user = displayName.trim().length === 0 ? username : displayName;
  const text = status.get('search_index');
  const attachmentCount = status.get('media_attachments').size;

  return text ? `${user}: "${truncate(text, 30)}"` : intl.formatMessage(messages.statusTitleWithAttachments, { user, attachmentCount });
};

class Status extends ImmutablePureComponent {

  static contextTypes = {
    router: PropTypes.object,
    identity: PropTypes.object,
  };

  static propTypes = {
    params: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
    status: ImmutablePropTypes.map,
    isLoading: PropTypes.bool,
    settings: ImmutablePropTypes.map.isRequired,
    ancestorsIds: ImmutablePropTypes.list,
    descendantsIds: ImmutablePropTypes.list,
    intl: PropTypes.object.isRequired,
    askReplyConfirmation: PropTypes.bool,
    multiColumn: PropTypes.bool,
    domain: PropTypes.string.isRequired,
    pictureInPicture: ImmutablePropTypes.contains({
      inUse: PropTypes.bool,
      available: PropTypes.bool,
    }),
  };

  state = {
    fullscreen: false,
    isExpanded: undefined,
    threadExpanded: undefined,
    statusId: undefined,
    loadedStatusId: undefined,
    showMedia: undefined,
    revealBehindCW: undefined,
  };

  componentDidMount () {
    attachFullscreenListener(this.onFullScreenChange);
    this.props.dispatch(fetchStatus(this.props.params.statusId));

    const { status, ancestorsIds } = this.props;

    if (status && ancestorsIds && ancestorsIds.size > 0) {
      const element = this.node.querySelectorAll('.focusable')[ancestorsIds.size - 1];

      window.requestAnimationFrame(() => {
        element.scrollIntoView(true);
      });
    }
  }

  static getDerivedStateFromProps(props, state) {
    let update = {};
    let updated = false;

    if (props.params.statusId && state.statusId !== props.params.statusId) {
      props.dispatch(fetchStatus(props.params.statusId));
      update.threadExpanded = undefined;
      update.statusId = props.params.statusId;
      updated = true;
    }

    const revealBehindCW = props.settings.getIn(['media', 'reveal_behind_cw']);
    if (revealBehindCW !== state.revealBehindCW) {
      update.revealBehindCW = revealBehindCW;
      if (revealBehindCW) update.showMedia = defaultMediaVisibility(props.status, props.settings);
      updated = true;
    }

    if (props.status && state.loadedStatusId !== props.status.get('id')) {
      update.showMedia = defaultMediaVisibility(props.status, props.settings);
      update.loadedStatusId = props.status.get('id');
      update.isExpanded = autoUnfoldCW(props.settings, props.status);
      updated = true;
    }

    return updated ? update : null;
  }

  handleToggleHidden = () => {
    const { status } = this.props;

    if (this.props.settings.getIn(['content_warnings', 'shared_state'])) {
      if (status.get('hidden')) {
        this.props.dispatch(revealStatus(status.get('id')));
      } else {
        this.props.dispatch(hideStatus(status.get('id')));
      }
    } else if (this.props.status.get('spoiler_text')) {
      this.setExpansion(!this.state.isExpanded);
    }
  };

  handleToggleMediaVisibility = () => {
    this.setState({ showMedia: !this.state.showMedia });
  };

  handleModalFavourite = (status) => {
    this.props.dispatch(favourite(status));
  };

  handleFavouriteClick = (status, e) => {
    const { dispatch } = this.props;
    const { signedIn } = this.context.identity;

    if (signedIn) {
      if (status.get('favourited')) {
        dispatch(unfavourite(status));
      } else {
        if ((e && e.shiftKey) || !favouriteModal) {
          this.handleModalFavourite(status);
        } else {
          dispatch(openModal({
            modalType: 'FAVOURITE',
            modalProps: {
              status,
              onFavourite: this.handleModalFavourite,
            },
          }));
        }
      }
    } else {
      dispatch(openModal({
        modalType: 'INTERACTION',
        modalProps: {
          type: 'favourite',
          accountId: status.getIn(['account', 'id']),
          url: status.get('url'),
        },
      }));
    }
  };

  handlePin = (status) => {
    if (status.get('pinned')) {
      this.props.dispatch(unpin(status));
    } else {
      this.props.dispatch(pin(status));
    }
  };

  handleReplyClick = (status) => {
    const { askReplyConfirmation, dispatch, intl } = this.props;
    const { signedIn } = this.context.identity;

    if (signedIn) {
      if (askReplyConfirmation) {
        dispatch(openModal({
          modalType: 'CONFIRM',
          modalProps: {
            message: intl.formatMessage(messages.replyMessage),
            confirm: intl.formatMessage(messages.replyConfirm),
            onDoNotAsk: () => dispatch(changeLocalSetting(['confirm_before_clearing_draft'], false)),
            onConfirm: () => dispatch(replyCompose(status, this.context.router.history)),
          },
        }));
      } else {
        dispatch(replyCompose(status, this.context.router.history));
      }
    } else {
      dispatch(openModal({
        modalType: 'INTERACTION',
        modalProps: {
          type: 'reply',
          accountId: status.getIn(['account', 'id']),
          url: status.get('url'),
        },
      }));
    }
  };

  handleModalReblog = (status, privacy) => {
    const { dispatch } = this.props;

    if (status.get('reblogged')) {
      dispatch(unreblog(status));
    } else {
      dispatch(reblog(status, privacy));
    }
  };

  handleReblogClick = (status, e) => {
    const { settings, dispatch } = this.props;
    const { signedIn } = this.context.identity;

    if (signedIn) {
      if (settings.get('confirm_boost_missing_media_description') && status.get('media_attachments').some(item => !item.get('description')) && !status.get('reblogged')) {
        dispatch(initBoostModal({ status, onReblog: this.handleModalReblog, missingMediaDescription: true }));
      } else if ((e && e.shiftKey) || !boostModal) {
        this.handleModalReblog(status);
      } else {
        dispatch(initBoostModal({ status, onReblog: this.handleModalReblog }));
      }
    } else {
      dispatch(openModal({
        modalType: 'INTERACTION',
        modalProps: {
          type: 'reblog',
          accountId: status.getIn(['account', 'id']),
          url: status.get('url'),
        },
      }));
    }
  };

  handleBookmarkClick = (status) => {
    if (status.get('bookmarked')) {
      this.props.dispatch(unbookmark(status));
    } else {
      this.props.dispatch(bookmark(status));
    }
  };

  handleDeleteClick = (status, history, withRedraft = false) => {
    const { dispatch, intl } = this.props;

    if (!deleteModal) {
      dispatch(deleteStatus(status.get('id'), history, withRedraft));
    } else {
      dispatch(openModal({
        modalType: 'CONFIRM',
        modalProps: {
          message: intl.formatMessage(withRedraft ? messages.redraftMessage : messages.deleteMessage),
          confirm: intl.formatMessage(withRedraft ? messages.redraftConfirm : messages.deleteConfirm),
          onConfirm: () => dispatch(deleteStatus(status.get('id'), history, withRedraft)),
        },
      }));
    }
  };

  handleEditClick = (status, history) => {
    this.props.dispatch(editStatus(status.get('id'), history));
  };

  handleDirectClick = (account, router) => {
    this.props.dispatch(directCompose(account, router));
  };

  handleMentionClick = (account, router) => {
    this.props.dispatch(mentionCompose(account, router));
  };

  handleOpenMedia = (media, index, lang) => {
    this.props.dispatch(openModal({
      modalType: 'MEDIA',
      modalProps: { statusId: this.props.status.get('id'), media, index, lang },
    }));
  };

  handleOpenVideo = (media, lang, options) => {
    this.props.dispatch(openModal({
      modalType: 'VIDEO',
      modalProps: { statusId: this.props.status.get('id'), media, lang, options },
    }));
  };

  handleHotkeyOpenMedia = e => {
    const { status } = this.props;

    e.preventDefault();

    if (status.get('media_attachments').size > 0) {
      if (status.getIn(['media_attachments', 0, 'type']) === 'video') {
        this.handleOpenVideo(status.getIn(['media_attachments', 0]), { startTime: 0 });
      } else {
        this.handleOpenMedia(status.get('media_attachments'), 0);
      }
    }
  };

  handleMuteClick = (account) => {
    this.props.dispatch(initMuteModal(account));
  };

  handleConversationMuteClick = (status) => {
    if (status.get('muted')) {
      this.props.dispatch(unmuteStatus(status.get('id')));
    } else {
      this.props.dispatch(muteStatus(status.get('id')));
    }
  };

  handleToggleAll = () => {
    const { status, ancestorsIds, descendantsIds, settings } = this.props;
    const statusIds = [status.get('id')].concat(ancestorsIds.toJS(), descendantsIds.toJS());
    let { isExpanded } = this.state;

    if (settings.getIn(['content_warnings', 'shared_state']))
      isExpanded = !status.get('hidden');

    if (!isExpanded) {
      this.props.dispatch(revealStatus(statusIds));
    } else {
      this.props.dispatch(hideStatus(statusIds));
    }

    this.setState({ isExpanded: !isExpanded, threadExpanded: !isExpanded });
  };

  handleTranslate = status => {
    const { dispatch } = this.props;

    if (status.get('translation')) {
      dispatch(undoStatusTranslation(status.get('id'), status.get('poll')));
    } else {
      dispatch(translateStatus(status.get('id')));
    }
  };

  handleBlockClick = (status) => {
    const { dispatch } = this.props;
    const account = status.get('account');
    dispatch(initBlockModal(account));
  };

  handleReport = (status) => {
    this.props.dispatch(initReport(status.get('account'), status));
  };

  handleEmbed = (status) => {
    this.props.dispatch(openModal({
      modalType: 'EMBED',
      modalProps: { id: status.get('id') },
    }));
  };

  handleHotkeyToggleSensitive = () => {
    this.handleToggleMediaVisibility();
  };

  handleHotkeyMoveUp = () => {
    this.handleMoveUp(this.props.status.get('id'));
  };

  handleHotkeyMoveDown = () => {
    this.handleMoveDown(this.props.status.get('id'));
  };

  handleHotkeyReply = e => {
    e.preventDefault();
    this.handleReplyClick(this.props.status);
  };

  handleHotkeyFavourite = () => {
    this.handleFavouriteClick(this.props.status);
  };

  handleHotkeyBoost = () => {
    this.handleReblogClick(this.props.status);
  };

  handleHotkeyBookmark = () => {
    this.handleBookmarkClick(this.props.status);
  };

  handleHotkeyMention = e => {
    e.preventDefault();
    this.handleMentionClick(this.props.status);
  };

  handleHotkeyOpenProfile = () => {
    this.context.router.history.push(`/@${this.props.status.getIn(['account', 'acct'])}`);
  };

  handleMoveUp = id => {
    const { status, ancestorsIds, descendantsIds } = this.props;

    if (id === status.get('id')) {
      this._selectChild(ancestorsIds.size - 1, true);
    } else {
      let index = ancestorsIds.indexOf(id);

      if (index === -1) {
        index = descendantsIds.indexOf(id);
        this._selectChild(ancestorsIds.size + index, true);
      } else {
        this._selectChild(index - 1, true);
      }
    }
  };

  handleMoveDown = id => {
    const { status, ancestorsIds, descendantsIds } = this.props;

    if (id === status.get('id')) {
      this._selectChild(ancestorsIds.size + 1, false);
    } else {
      let index = ancestorsIds.indexOf(id);

      if (index === -1) {
        index = descendantsIds.indexOf(id);
        this._selectChild(ancestorsIds.size + index + 2, false);
      } else {
        this._selectChild(index + 1, false);
      }
    }
  };

  _selectChild (index, align_top) {
    const container = this.node;
    const element = container.querySelectorAll('.focusable')[index];

    if (element) {
      if (align_top && container.scrollTop > element.offsetTop) {
        element.scrollIntoView(true);
      } else if (!align_top && container.scrollTop + container.clientHeight < element.offsetTop + element.offsetHeight) {
        element.scrollIntoView(false);
      }
      element.focus();
    }
  }

  handleHeaderClick = () => {
    this.column.scrollTop();
  };

  renderChildren (list, ancestors) {
    const { params: { statusId } } = this.props;

    return list.map((id, i) => (
      <StatusContainer
        key={id}
        id={id}
        expanded={this.state.threadExpanded}
        onMoveUp={this.handleMoveUp}
        onMoveDown={this.handleMoveDown}
        contextType='thread'
        previousId={i > 0 && list.get(i - 1)}
        nextId={list.get(i + 1) || (ancestors && statusId)}
        rootId={statusId}
      />
    ));
  }

  setExpansion = value => {
    this.setState({ isExpanded: value });
  };

  setRef = c => {
    this.node = c;
  };

  setColumnRef = c => {
    this.column = c;
  };

  componentDidUpdate (prevProps) {
    if (this.props.params.statusId && (this.props.params.statusId !== prevProps.params.statusId || prevProps.ancestorsIds.size < this.props.ancestorsIds.size)) {
      const { status, ancestorsIds } = this.props;

      if (status && ancestorsIds && ancestorsIds.size > 0) {
        const element = this.node.querySelectorAll('.focusable')[ancestorsIds.size - 1];

        window.requestAnimationFrame(() => {
          element.scrollIntoView(true);
        });
      }
    }
  }

  componentWillUnmount () {
    detachFullscreenListener(this.onFullScreenChange);
  }

  onFullScreenChange = () => {
    this.setState({ fullscreen: isFullscreen() });
  };

  render () {
    let ancestors, descendants;
    const { isLoading, status, settings, ancestorsIds, descendantsIds, intl, domain, multiColumn, pictureInPicture } = this.props;
    const { fullscreen } = this.state;

    if (isLoading) {
      return (
        <Column>
          <LoadingIndicator />
        </Column>
      );
    }

    if (status === null) {
      return (
        <BundleColumnError multiColumn={multiColumn} errorType='routing' />
      );
    }

    const isExpanded = settings.getIn(['content_warnings', 'shared_state']) ? !status.get('hidden') : this.state.isExpanded;

    if (ancestorsIds && ancestorsIds.size > 0) {
      ancestors = <>{this.renderChildren(ancestorsIds, true)}</>;
    }

    if (descendantsIds && descendantsIds.size > 0) {
      descendants = <>{this.renderChildren(descendantsIds)}</>;
    }

    const isLocal = status.getIn(['account', 'acct'], '').indexOf('@') === -1;
    const isIndexable = !status.getIn(['account', 'noindex']);

    const handlers = {
      moveUp: this.handleHotkeyMoveUp,
      moveDown: this.handleHotkeyMoveDown,
      reply: this.handleHotkeyReply,
      favourite: this.handleHotkeyFavourite,
      boost: this.handleHotkeyBoost,
      bookmark: this.handleHotkeyBookmark,
      mention: this.handleHotkeyMention,
      openProfile: this.handleHotkeyOpenProfile,
      toggleSpoiler: this.handleToggleHidden,
      toggleSensitive: this.handleHotkeyToggleSensitive,
      openMedia: this.handleHotkeyOpenMedia,
    };

    return (
      <Column bindToDocument={!multiColumn} ref={this.setColumnRef} label={intl.formatMessage(messages.detailedStatus)}>
        <ColumnHeader
          icon='comment'
          title={intl.formatMessage(messages.tootHeading)}
          onClick={this.handleHeaderClick}
          showBackButton
          multiColumn={multiColumn}
          extraButton={(
            <button className='column-header__button' title={intl.formatMessage(!isExpanded ? messages.revealAll : messages.hideAll)} aria-label={intl.formatMessage(!isExpanded ? messages.revealAll : messages.hideAll)} onClick={this.handleToggleAll}><Icon id={!isExpanded ? 'eye-slash' : 'eye'} /></button>
          )}
        />

        <ScrollContainer scrollKey='thread'>
          <div className={classNames('scrollable', 'detailed-status__wrapper', { fullscreen })} ref={this.setRef}>
            {ancestors}

            <HotKeys handlers={handlers}>
              <div className='focusable' tabIndex={0} aria-label={textForScreenReader(intl, status, false, isExpanded)}>
                <DetailedStatus
                  key={`details-${status.get('id')}`}
                  status={status}
                  settings={settings}
                  onOpenVideo={this.handleOpenVideo}
                  onOpenMedia={this.handleOpenMedia}
                  expanded={isExpanded}
                  onToggleHidden={this.handleToggleHidden}
                  onTranslate={this.handleTranslate}
                  domain={domain}
                  showMedia={this.state.showMedia}
                  onToggleMediaVisibility={this.handleToggleMediaVisibility}
                  pictureInPicture={pictureInPicture}
                />

                <ActionBar
                  key={`action-bar-${status.get('id')}`}
                  status={status}
                  onReply={this.handleReplyClick}
                  onFavourite={this.handleFavouriteClick}
                  onReblog={this.handleReblogClick}
                  onBookmark={this.handleBookmarkClick}
                  onDelete={this.handleDeleteClick}
                  onEdit={this.handleEditClick}
                  onDirect={this.handleDirectClick}
                  onMention={this.handleMentionClick}
                  onMute={this.handleMuteClick}
                  onMuteConversation={this.handleConversationMuteClick}
                  onBlock={this.handleBlockClick}
                  onReport={this.handleReport}
                  onPin={this.handlePin}
                  onEmbed={this.handleEmbed}
                />
              </div>
            </HotKeys>

            {descendants}
          </div>
        </ScrollContainer>

        <Helmet>
          <title>{titleFromStatus(intl, status)}</title>
          <meta name='robots' content={(isLocal && isIndexable) ? 'all' : 'noindex'} />
          <link rel='canonical' href={status.get('url')} />
        </Helmet>
      </Column>
    );
  }

}

export default injectIntl(connect(makeMapStateToProps)(Status));
