const { LikeService } = require('../../src/modules/posts/services/like.service');
const { PostNotFoundError } = require('../../src/modules/posts/errors/post.errors');

function makePost(overrides = {}) {
  return {
    _id: 'post-1',
    likesCount: 0,
    author: { _id: 'author-1', isActive: true, isPrivate: false },
    ...overrides,
  };
}

describe('LikeService.setLikeState (unit, mocked repositories)', () => {
  let likeRepository;
  let postRepository;
  let followRepository;
  let service;

  beforeEach(() => {
    likeRepository = {
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue(null),
    };
    postRepository = {
      findVisibleById: jest.fn(),
      incrementLikesCount: jest.fn(),
    };
    followRepository = { exists: jest.fn().mockResolvedValue(true) };
    service = new LikeService(likeRepository, postRepository, followRepository);
  });

  it('throws PostNotFoundError when the post does not exist', async () => {
    postRepository.findVisibleById.mockResolvedValue(null);
    await expect(service.setLikeState({ postId: 'post-1', userId: 'u1', liked: true })).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    expect(likeRepository.create).not.toHaveBeenCalled();
  });

  it('throws PostNotFoundError (not 403) when the post is behind a private account the user cannot see', async () => {
    postRepository.findVisibleById.mockResolvedValue(
      makePost({ author: { _id: 'author-1', isActive: true, isPrivate: true } }),
    );
    followRepository.exists.mockResolvedValue(false);

    await expect(service.setLikeState({ postId: 'post-1', userId: 'stranger', liked: true })).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    expect(likeRepository.create).not.toHaveBeenCalled();
  });

  it('is a no-op returning the current count when already in the desired state (liked=true, already liked)', async () => {
    postRepository.findVisibleById.mockResolvedValue(makePost({ likesCount: 5 }));
    likeRepository.exists.mockResolvedValue(true);

    const result = await service.setLikeState({ postId: 'post-1', userId: 'u1', liked: true });

    expect(result).toEqual({ liked: true, likesCount: 5 });
    expect(likeRepository.create).not.toHaveBeenCalled();
    expect(postRepository.incrementLikesCount).not.toHaveBeenCalled();
  });

  it('is a no-op when already unliked (liked=false, not currently liked)', async () => {
    postRepository.findVisibleById.mockResolvedValue(makePost({ likesCount: 0 }));
    likeRepository.exists.mockResolvedValue(false);

    const result = await service.setLikeState({ postId: 'post-1', userId: 'u1', liked: false });

    expect(result).toEqual({ liked: false, likesCount: 0 });
    expect(likeRepository.deleteOne).not.toHaveBeenCalled();
  });

  it('likes the post and returns the incremented count', async () => {
    postRepository.findVisibleById.mockResolvedValue(makePost({ likesCount: 2 }));
    likeRepository.exists.mockResolvedValue(false);
    postRepository.incrementLikesCount.mockResolvedValue({ likesCount: 3 });

    const result = await service.setLikeState({ postId: 'post-1', userId: 'u1', liked: true });

    expect(result).toEqual({ liked: true, likesCount: 3 });
    expect(likeRepository.create).toHaveBeenCalledWith('u1', 'post-1', expect.anything());
    expect(postRepository.incrementLikesCount).toHaveBeenCalledWith('post-1', 1, expect.anything());
  });

  it('unlikes the post and returns the decremented count', async () => {
    postRepository.findVisibleById.mockResolvedValue(makePost({ likesCount: 3 }));
    likeRepository.exists.mockResolvedValue(true);
    likeRepository.deleteOne.mockResolvedValue({ _id: 'like-1' });
    postRepository.incrementLikesCount.mockResolvedValue({ likesCount: 2 });

    const result = await service.setLikeState({ postId: 'post-1', userId: 'u1', liked: false });

    expect(result).toEqual({ liked: false, likesCount: 2 });
    expect(postRepository.incrementLikesCount).toHaveBeenCalledWith('post-1', -1, expect.anything());
  });

  it('recovers from a duplicate-key race on like by returning the current count without double-incrementing', async () => {
    postRepository.findVisibleById
      .mockResolvedValueOnce(makePost({ likesCount: 2 })) // initial read
      .mockResolvedValueOnce(makePost({ likesCount: 3 })); // post-race re-read
    likeRepository.exists.mockResolvedValue(false);
    likeRepository.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));

    const result = await service.setLikeState({ postId: 'post-1', userId: 'u1', liked: true });

    expect(result).toEqual({ liked: true, likesCount: 3 });
    expect(postRepository.incrementLikesCount).not.toHaveBeenCalled();
  });

  it('recovers from a lost unlike race (already deleted by a concurrent request) without double-decrementing', async () => {
    postRepository.findVisibleById
      .mockResolvedValueOnce(makePost({ likesCount: 3 }))
      .mockResolvedValueOnce(makePost({ likesCount: 2 }));
    likeRepository.exists.mockResolvedValue(true);
    likeRepository.deleteOne.mockResolvedValue(null); // someone else's concurrent unlike already won

    const result = await service.setLikeState({ postId: 'post-1', userId: 'u1', liked: false });

    expect(result).toEqual({ liked: false, likesCount: 2 });
    expect(postRepository.incrementLikesCount).not.toHaveBeenCalled();
  });

  it('floors at 0 instead of crashing when the counter is already at 0 despite a Like row existing (data-inconsistency edge case)', async () => {
    postRepository.findVisibleById.mockResolvedValue(makePost({ likesCount: 0 }));
    likeRepository.exists.mockResolvedValue(true);
    likeRepository.deleteOne.mockResolvedValue({ _id: 'like-1' });
    postRepository.incrementLikesCount.mockResolvedValue(null); // repository's own floor guard tripped

    const result = await service.setLikeState({ postId: 'post-1', userId: 'u1', liked: false });

    expect(result).toEqual({ liked: false, likesCount: 0 });
  });

  it('propagates a non-duplicate-key error from the like insert unchanged', async () => {
    postRepository.findVisibleById.mockResolvedValue(makePost());
    likeRepository.exists.mockResolvedValue(false);
    likeRepository.create.mockRejectedValue(new Error('connection reset'));

    await expect(service.setLikeState({ postId: 'post-1', userId: 'u1', liked: true })).rejects.toThrow(
      'connection reset',
    );
  });
});
