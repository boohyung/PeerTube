import * as Sequelize from 'sequelize'
import { ResultList } from '../../shared/models'
import { VideoCommentThreadTree } from '../../shared/models/videos/video-comment.model'
import { VideoModel } from '../models/video/video'
import { VideoCommentModel } from '../models/video/video-comment'
import { getVideoCommentActivityPubUrl, sendVideoRateChangeToFollowers } from './activitypub'
import { sendCreateVideoCommentToOrigin, sendCreateVideoCommentToVideoFollowers } from './activitypub/send'

async function createVideoComment (obj: {
  text: string,
  inReplyToComment: VideoCommentModel,
  video: VideoModel
  accountId: number
}, t: Sequelize.Transaction) {
  let originCommentId: number = null

  if (obj.inReplyToComment) {
    originCommentId = obj.inReplyToComment.originCommentId || obj.inReplyToComment.id
  }

  const comment = await VideoCommentModel.create({
    text: obj.text,
    originCommentId,
    inReplyToCommentId: obj.inReplyToComment.id,
    videoId: obj.video.id,
    accountId: obj.accountId,
    url: 'fake url'
  }, { transaction: t, validate: false })

  comment.set('url', getVideoCommentActivityPubUrl(obj.video, comment))

  const savedComment = await comment.save({ transaction: t })
  savedComment.InReplyToVideoComment = obj.inReplyToComment
  savedComment.Video = obj.video

  if (savedComment.Video.isOwned()) {
    await sendCreateVideoCommentToVideoFollowers(savedComment, t)
  } else {
    await sendCreateVideoCommentToOrigin(savedComment, t)
  }

  return savedComment
}

function buildFormattedCommentTree (resultList: ResultList<VideoCommentModel>): VideoCommentThreadTree {
  // Comments are sorted by id ASC
  const comments = resultList.data

  const comment = comments.shift()
  const thread: VideoCommentThreadTree = {
    comment: comment.toFormattedJSON(),
    children: []
  }
  const idx = {
    [comment.id]: thread
  }

  while (comments.length !== 0) {
    const childComment = comments.shift()

    const childCommentThread: VideoCommentThreadTree = {
      comment: childComment.toFormattedJSON(),
      children: []
    }

    const parentCommentThread = idx[childComment.inReplyToCommentId]
    if (!parentCommentThread) {
      const msg = `Cannot format video thread tree, parent ${childComment.inReplyToCommentId} not found for child ${childComment.id}`
      throw new Error(msg)
    }

    parentCommentThread.children.push(childCommentThread)
    idx[childComment.id] = childCommentThread
  }

  return thread
}

// ---------------------------------------------------------------------------

export {
  createVideoComment,
  buildFormattedCommentTree
}